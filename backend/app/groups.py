import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId

from .database import groups_collection, group_members_collection, messages_collection, redis_client
from .auth import get_current_user

router = APIRouter(prefix="/api/groups", tags=["groups"])

def serialize_doc(doc):
    if not doc: return None
    doc = dict(doc)  # copy so we don't mutate the original MongoDB doc
    doc["id"] = str(doc.pop("_id"))
    return doc

@router.post("")
async def create_group(name: str, user: dict = Depends(get_current_user)):
    join_code = str(uuid.uuid4())[:8].upper()
    group = {
        "name": name,
        "join_code": join_code,
        "admin": user["username"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await groups_collection.insert_one(group)
    group_id = str(result.inserted_id)
    
    # Add creator as an approved member
    member = {
        "group_id": group_id,
        "username": user["username"],
        "status": "approved",
        "joined_at": datetime.now(timezone.utc).isoformat()
    }
    await group_members_collection.insert_one(member)
    
    group["id"] = group_id
    del group["_id"]
    return group

@router.get("")
async def list_groups(user: dict = Depends(get_current_user)):
    memberships = await group_members_collection.find({"username": user["username"]}).to_list(length=None)
    group_ids = [ObjectId(m["group_id"]) for m in memberships if m["status"] == "approved"]
    
    groups = await groups_collection.find({"_id": {"$in": group_ids}}).to_list(length=None)
    
    result = []
    for g in groups:
        doc = serialize_doc(g)
        unread = await messages_collection.count_documents({
            "room": doc["id"],
            "username": {"$ne": user["username"]},
            "readers": {"$ne": user["username"]}
        })
        doc["unread_count"] = unread
        result.append(doc)
    return result

@router.post("/join")
async def join_group(join_code: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"join_code": join_code})
    if not group:
        raise HTTPException(status_code=404, detail="Group not found or invalid join code")
    
    group_id = str(group["_id"])
    
    # Check if already a member or pending
    existing = await group_members_collection.find_one({"group_id": group_id, "username": user["username"]})
    if existing:
        if existing["status"] == "approved":
            raise HTTPException(status_code=400, detail="Already a member")
        else:
            raise HTTPException(status_code=400, detail="Join request is already pending")
            
    member = {
        "group_id": group_id,
        "username": user["username"],
        "status": "pending",
        "joined_at": datetime.now(timezone.utc).isoformat()
    }
    await group_members_collection.insert_one(member)
    return {"message": "Join request sent. Waiting for admin approval."}

@router.get("/{group_id}/requests")
async def list_requests(group_id: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group or group["admin"] != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    requests = await group_members_collection.find({"group_id": group_id, "status": "pending"}).to_list(length=None)
    return [serialize_doc(r) for r in requests]

@router.post("/{group_id}/requests/{username}/approve")
async def approve_request(group_id: str, username: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group or group["admin"] != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    result = await group_members_collection.update_one(
        {"group_id": group_id, "username": username},
        {"$set": {"status": "approved"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Request not found")
        
    return {"message": "Request approved"}

@router.post("/{group_id}/requests/{username}/reject")
async def reject_request(group_id: str, username: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group or group["admin"] != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    result = await group_members_collection.delete_one({"group_id": group_id, "username": username, "status": "pending"})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Request not found")
        
    return {"message": "Request rejected"}

@router.delete("/{group_id}/members/{username}")
async def remove_member(group_id: str, username: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
        
    # Either admin is removing someone, or user is leaving themselves
    if group["admin"] != user["username"] and user["username"] != username:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    if group["admin"] == username:
        raise HTTPException(status_code=400, detail="Admin cannot be removed. Transfer ownership or delete group.")
        
    result = await group_members_collection.delete_one({"group_id": group_id, "username": username})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
        
    return {"message": "Member removed"}

@router.put("/{group_id}")
async def update_group(group_id: str, name: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group or group["admin"] != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    await groups_collection.update_one({"_id": ObjectId(group_id)}, {"$set": {"name": name}})
    return {"message": "Group updated"}

@router.post("/{group_id}/regenerate-code")
async def regenerate_code(group_id: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group or group["admin"] != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    new_code = str(uuid.uuid4())[:8].upper()
    await groups_collection.update_one({"_id": ObjectId(group_id)}, {"$set": {"join_code": new_code}})
    return {"join_code": new_code}

@router.delete("/{group_id}/messages")
async def clear_messages(group_id: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group or group["admin"] != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    await messages_collection.delete_many({"room": group_id})
    await redis_client.delete(f"room:{group_id}:history")
    
    from .connection_manager import manager
    await manager.broadcast(
        group_id,
        {"type": "clear_chat", "room": group_id},
    )
    return {"message": "Messages cleared"}

@router.delete("/{group_id}")
async def delete_group(group_id: str, user: dict = Depends(get_current_user)):
    group = await groups_collection.find_one({"_id": ObjectId(group_id)})
    if not group or group["admin"] != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    await groups_collection.delete_one({"_id": ObjectId(group_id)})
    await group_members_collection.delete_many({"group_id": group_id})
    await messages_collection.delete_many({"room": group_id})
    # Clean up all Redis keys for this group
    await redis_client.delete(f"room:{group_id}:history")
    await redis_client.delete(f"room:{group_id}:users")
    return {"message": "Group deleted"}

@router.get("/{group_id}/members")
async def list_members(group_id: str, user: dict = Depends(get_current_user)):
    # Check if user is an approved member
    membership = await group_members_collection.find_one({"group_id": group_id, "username": user["username"], "status": "approved"})
    if not membership:
        raise HTTPException(status_code=403, detail="Not authorized to view members")
        
    members = await group_members_collection.find({"group_id": group_id, "status": "approved"}).to_list(length=None)
    
    # Get online users from redis
    online_users_set = await redis_client.smembers(f"room:{group_id}:users")
    
    result = []
    for m in members:
        is_online = m["username"] in online_users_set
        doc = serialize_doc(m)
        doc["is_online"] = is_online
        result.append(doc)
        
    return result
