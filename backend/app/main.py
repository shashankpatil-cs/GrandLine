import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from bson import ObjectId

from .database import messages_collection, init_db, redis_client, group_members_collection
from .models import serialize_message
from .connection_manager import manager
from .auth import router as auth_router, get_current_user, get_user_from_token
from .kafka_client import init_kafka, close_kafka
from .groups import router as groups_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Clear stale online presence, user sessions, and statuses from previous runs
    stale_keys = await redis_client.keys("room:*:users")
    if stale_keys:
        await redis_client.delete(*stale_keys)
    stale_sessions = await redis_client.keys("user_session:*")
    if stale_sessions:
        await redis_client.delete(*stale_sessions)
    stale_statuses = await redis_client.keys("status:*")
    if stale_statuses:
        await redis_client.delete(*stale_statuses)
    # Hook up Kafka consumer to manager's local broadcast function
    await init_kafka(manager.local_broadcast)
    yield
    await close_kafka()


app = FastAPI(title="Simple Chat", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(groups_router)

cors_origins_raw = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000",
)
allowed_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/rooms/{room}/messages")
async def get_history(room: str, limit: int = Query(30, le=200), user: dict = Depends(get_current_user)):
    """Return the most recent messages for a room, oldest first."""
    # Verify membership
    membership = await group_members_collection.find_one({"group_id": room, "username": user["username"], "status": "approved"})
    if not membership:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Not authorized to view messages in this group")

    cached = await redis_client.lrange(f"room:{room}:history", 0, -1)
    if cached:
        return [json.loads(m) for m in cached]

    cursor = (
        messages_collection.find({"room": room, "type": {"$ne": "system"}})
        .sort("timestamp", -1)
        .limit(30)
    )
    docs = [doc async for doc in cursor]
    docs.reverse()
    messages = [serialize_message(doc) for doc in docs]
    
    if messages:
        # Repopulate cache
        await redis_client.delete(f"room:{room}:history")
        await redis_client.rpush(f"room:{room}:history", *[json.dumps(m) for m in messages])
        
    # --- Attach live read receipts ---
    if messages:
        pipe = redis_client.pipeline()
        for msg in messages:
            pipe.smembers(f"msg:{msg['id']}:read_by")
        readers_list = await pipe.execute()
        for i, msg in enumerate(messages):
            msg["readers"] = sorted(list(readers_list[i]))
            
    return messages


async def save_message(room: str, username: str, text: str) -> dict:
    from .kafka_client import publish_db_write
    
    doc = {
        "_id": str(ObjectId()),
        "room": room,
        "username": username,
        "text": text,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": "message",
    }
    
    # 1. Throw it onto the Kafka belt for the background script to save!
    await publish_db_write(doc)
    
    msg = serialize_message(doc)
    
    # 2. Keep the instant Redis cache so the chat feels incredibly fast
    await redis_client.rpush(f"room:{room}:history", json.dumps(msg))
    await redis_client.ltrim(f"room:{room}:history", -30, -1)
    
    return msg


@app.websocket("/ws/{room}")
async def websocket_endpoint(websocket: WebSocket, room: str, token: str = Query(...)):
    try:
        user = await get_user_from_token(token)
    except Exception:
        await websocket.close(code=1008, reason="Unauthorized")
        return
        
    username = user["username"]
    
    # Verify membership
    membership = await group_members_collection.find_one({"group_id": room, "username": username, "status": "approved"})
    if not membership:
        await websocket.close(code=1008, reason="Not an approved member")
        return

    await manager.connect(room, username, websocket)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            event_type = data.get("type", "message")

            if event_type == "message":
                text = (data.get("text") or "").strip()
                if not text:
                    continue
                
                # --- Rate Limiting (5 messages per 3 seconds, per room) ---
                rate_key = f"rate_limit:{username}:{room}"
                current_count = await redis_client.incr(rate_key)
                if current_count == 1:
                    await redis_client.expire(rate_key, 3)
                    
                if current_count > 5:
                    error_msg = {
                        "type": "system",
                        "text": "Slow down! You are sending messages too fast 🛑",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    await websocket.send_text(json.dumps(error_msg))
                    continue
                # ------------------------------------------------
                
                msg = await save_message(room, username, text[:2000])
                await manager.broadcast(room, msg)

            elif event_type == "typing":
                # Save typing status in Redis for 3 seconds
                await redis_client.setex(f"typing:{room}:{username}", 3, "true")
                
                # Fetch everyone currently typing in this room
                typing_keys = await redis_client.keys(f"typing:{room}:*")
                typists = [key.split(":")[-1] for key in typing_keys]
                
                await manager.broadcast(
                    room,
                    {"type": "typing", "room": room, "typists": typists},
                )
                
            elif event_type == "read":
                message_id = data.get("message_id")
                if message_id:
                    from .kafka_client import publish_read_receipt
                    await publish_read_receipt({
                        "message_id": message_id,
                        "username": username,
                        "room": room
                    })

            elif event_type == "status":
                status = data.get("status")
                if status in ["active", "away"]:
                    # Save status to redis with an expiry so it doesn't linger forever
                    await redis_client.setex(f"status:{room}:{username}", 3600, status)
                    
                    status_keys = await redis_client.keys(f"status:{room}:*")
                    statuses = {}
                    if status_keys:
                        values = await redis_client.mget(status_keys)
                        for key, val in zip(status_keys, values):
                            uname = key.split(":")[-1]
                            statuses[uname] = val
                            
                    await manager.broadcast(
                        room,
                        {"type": "status_update", "room": room, "statuses": statuses}
                    )

    except WebSocketDisconnect:
        manager.disconnect(room, websocket)

