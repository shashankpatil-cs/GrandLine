import json
import asyncio
from typing import Dict, Set, Tuple
from fastapi import WebSocket
from bson import ObjectId
from datetime import datetime, timezone


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
            
        # Only broadcast join if they weren't already connected AND there wasn't a cancelled disconnect
        # (If there was a cancelled disconnect, they never "left", so they don't need to "join" again)
        if not user_already_in_room and not task:
            join_event = {
                "id": f"sys_{ObjectId()}",
                "room": room,
                "username": username,
                "text": f"{username} joined the chat",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "type": "system",
            }
            await self.broadcast(room, join_event)
            await self.broadcast_presence(room)
        elif task:
            # They reconnected, just broadcast presence to update frontend in case
            await self.broadcast_presence(room)
        elif not user_already_in_room and task:
            pass # Actually if user_already_in_room is false but task exists, they are just reconnecting

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
            
            leave_event = {
                "id": f"sys_{ObjectId()}",
                "room": room,
                "username": username,
                "text": f"{username} left the chat",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "type": "system",
            }
            await self.broadcast(room, leave_event)
            await self.broadcast_presence(room)
        except asyncio.CancelledError:
            pass

    def online_users(self, room: str) -> Set[str]:
        return set(self.rooms.get(room, {}).values())

    async def broadcast(self, room: str, payload: dict, exclude: WebSocket | None = None):
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

    async def broadcast_presence(self, room: str):
        await self.broadcast(
            room,
            {"type": "presence", "room": room, "users": sorted(self.online_users(room))},
        )


manager = ConnectionManager()
