from datetime import datetime
from pydantic import BaseModel


class MessageOut(BaseModel):
    id: str
    room: str
    username: str
    text: str
    timestamp: datetime
    type: str = "message"  # message | system


def serialize_message(doc) -> dict:
    return {
        "id": str(doc["_id"]),
        "room": doc["room"],
        "username": doc["username"],
        "text": doc["text"],
        "timestamp": doc["timestamp"].isoformat(),
        "type": doc.get("type", "message"),
    }
