import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from bson import ObjectId

from .database import messages_collection, init_db
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
async def get_history(room: str, limit: int = Query(50, le=200), user: dict = Depends(get_current_user)):
    """Return the most recent messages for a room, oldest first."""
    cursor = (
        messages_collection.find({"room": room, "type": {"$ne": "system"}})
        .sort("timestamp", -1)
        .limit(limit)
    )
    docs = [doc async for doc in cursor]
    docs.reverse()
    return [serialize_message(doc) for doc in docs]


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
    return serialize_message(doc)


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
                msg = await save_message(room, username, text[:2000])
                await manager.broadcast(room, msg)

            elif event_type == "typing":
                await manager.broadcast(
                    room,
                    {"type": "typing", "room": room, "username": username},
                    exclude=websocket,
                )

            elif event_type == "clear_chat":
                await messages_collection.delete_many({"room": room})
                await manager.broadcast(
                    room,
                    {"type": "clear_chat", "room": room},
                )

    except WebSocketDisconnect:
        manager.disconnect(room, websocket)

