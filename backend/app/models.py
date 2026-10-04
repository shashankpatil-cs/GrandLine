from datetime import datetime
from pydantic import BaseModel

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str

class RefreshToken(BaseModel):
    refresh_token: str


class MessageOut(BaseModel):
    id: str
    room: str
    username: str
    text: str
    timestamp: datetime
    type: str = "message"  # message | system


def serialize_message(doc) -> dict:
    ts = doc["timestamp"]
    if not isinstance(ts, str):
        ts = ts.isoformat()
        
    ret = {
        "id": str(doc["_id"]),
        "room": doc["room"],
        "username": doc["username"],
        "text": doc["text"],
        "timestamp": ts,
        "type": doc.get("type", "message"),
    }
    if "reply_to" in doc:
        ret["reply_to"] = doc["reply_to"]
    return ret
