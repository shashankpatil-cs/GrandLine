import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from bson import ObjectId

from .database import messages_collection, init_db, redis_client
from .models import serialize_message
from .connection_manager import manager
from .auth import router as auth_router, get_current_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Simple Chat", lifespan=lifespan)
app.include_router(auth_router)

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
    doc = {
        "room": room,
        "username": username,
        "text": text,
        "timestamp": datetime.now(timezone.utc),
        "type": "message",
    }
    result = await messages_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    msg = serialize_message(doc)
    
    # Push to Redis and keep only last 30
    await redis_client.rpush(f"room:{room}:history", json.dumps(msg))
    await redis_client.ltrim(f"room:{room}:history", -30, -1)
    
    return msg


@app.websocket("/ws/{room}")
async def websocket_endpoint(websocket: WebSocket, room: str, username: str = Query(...)):
    username = username.strip()[:32] or "Anonymous"
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
                
                # --- Rate Limiting (5 messages per 3 seconds) ---
                rate_key = f"rate_limit:{username}"
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
                    # Add user to the read list for this message
                    await redis_client.sadd(f"msg:{message_id}:read_by", username)
                    readers = await redis_client.smembers(f"msg:{message_id}:read_by")
                    
                    # Broadcast updated read receipts
                    await manager.broadcast(
                        room,
                        {"type": "read_receipt", "message_id": message_id, "readers": sorted(list(readers))}
                    )

            elif event_type == "clear_chat":
                await messages_collection.delete_many({"room": room})
                await redis_client.delete(f"room:{room}:history")
                await manager.broadcast(
                    room,
                    {"type": "clear_chat", "room": room},
                )

    except WebSocketDisconnect:
        manager.disconnect(room, websocket)

