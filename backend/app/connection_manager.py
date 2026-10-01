import json
from typing import Dict, Set
from fastapi import WebSocket


class ConnectionManager:
    """Tracks active WebSocket connections per chat room and handles broadcast."""

    def __init__(self):
        # room -> {websocket -> username}
        self.rooms: Dict[str, Dict[WebSocket, str]] = {}

    async def connect(self, room: str, username: str, websocket: WebSocket):
        await websocket.accept()
        self.rooms.setdefault(room, {})[websocket] = username

    def disconnect(self, room: str, websocket: WebSocket):
        if room in self.rooms and websocket in self.rooms[room]:
            username = self.rooms[room].pop(websocket)
            if not self.rooms[room]:
                del self.rooms[room]
            return username
        return None

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
