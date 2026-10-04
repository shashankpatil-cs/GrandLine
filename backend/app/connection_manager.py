import json
import asyncio
from typing import Dict, Set, Tuple
from fastapi import WebSocket
from bson import ObjectId
from datetime import datetime, timezone
from .database import redis_client


class ConnectionManager:
    """Tracks active WebSocket connections per chat room and handles broadcast."""

    def __init__(self):
        # room -> {websocket -> username}
        self.rooms: Dict[str, Dict[WebSocket, str]] = {}
        # (room, username) -> asyncio.Task
        self.disconnect_tasks: Dict[Tuple[str, str], asyncio.Task] = {}

    async def connect(self, room: str, username: str, websocket: WebSocket):
        await websocket.accept()

        room_users = self.rooms.setdefault(room, {})
        user_already_in_room = username in room_users.values()
        
        room_users[websocket] = username

        # Cancel any pending disconnect task
        task = self.disconnect_tasks.pop((room, username), None)
        if task:
            task.cancel()
            
        # Add user to Redis Set for global presence
        await redis_client.sadd(f"room:{room}:users", username)

        # Disconnect any existing websocket for this username across all rooms
        # We don't manually pop them from self.rooms here. 
        # Calling close() triggers WebSocketDisconnect, running normal disconnect() cleanup.
        for r_name, connections in list(self.rooms.items()):
            for old_ws, old_user in list(connections.items()):
                if old_user == username and old_ws != websocket:
                    try:
                        await old_ws.close(code=1008, reason="New connection opened elsewhere")
                    except Exception:
                        pass
            
        # Only broadcast join if they weren't already connected AND there wasn't a cancelled disconnect
        # (If there was a cancelled disconnect, they never "left", so they don't need to "join" again)
        if not user_already_in_room and not task:
            await self.broadcast_presence(room)
        elif task:
            # They reconnected, just broadcast presence to update frontend in case
            await self.broadcast_presence(room)
        else:
            # If they opened a second tab with the same user, they still need the presence list!
            users = await self.get_online_users(room)
            await websocket.send_text(json.dumps({"type": "presence", "room": room, "users": users}))

    def disconnect(self, room: str, websocket: WebSocket):
        if room in self.rooms and websocket in self.rooms[room]:
            username = self.rooms[room].pop(websocket)
            
            if username not in self.rooms[room].values():
                task = asyncio.create_task(self._delayed_disconnect(room, username))
                self.disconnect_tasks[(room, username)] = task
                
            if not self.rooms[room]:
                del self.rooms[room]

    async def _delayed_disconnect(self, room: str, username: str):
        try:
            await asyncio.sleep(2.0)
            self.disconnect_tasks.pop((room, username), None)
            
            # Remove from Redis global presence and clean status
            await redis_client.srem(f"room:{room}:users", username)
            await redis_client.delete(f"status:{room}:{username}")
            
            await self.broadcast_presence(room)
        except asyncio.CancelledError:
            pass

    async def get_online_users(self, room: str) -> list:
        # Fetch from Redis instead of local memory
        users = await redis_client.smembers(f"room:{room}:users")
        return sorted(list(users))

    async def local_broadcast(self, room: str, payload: dict, exclude: WebSocket | None = None):
        dead = []
        for ws in self.rooms.get(room, {}):
            if exclude is not None and ws == exclude:
                continue
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room, ws)

    async def broadcast(self, room: str, payload: dict, exclude: WebSocket | None = None):
        from .kafka_client import publish_broadcast
        # We publish to Kafka. The consumer will read this and call local_broadcast!
        await publish_broadcast(payload)

    async def broadcast_presence(self, room: str):
        users = await self.get_online_users(room)
        await self.broadcast(
            room,
            {"type": "presence", "room": room, "users": users},
        )


manager = ConnectionManager()
