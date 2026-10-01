import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.getenv("MONGO_URL", "mongodb://mongo:27017")
DB_NAME = os.getenv("DB_NAME", "chatdb")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

messages_collection = db["messages"]


async def init_db():
    await messages_collection.create_index([("room", 1), ("timestamp", -1)])
