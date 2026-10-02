import os
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as redis

MONGO_URL = os.getenv("MONGO_URL", "mongodb://mongo:27017")
DB_NAME = os.getenv("DB_NAME", "chatdb")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

messages_collection = db["messages"]
users_collection = db["users"]

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
redis_client = redis.from_url(REDIS_URL, decode_responses=True)


async def init_db():
    await messages_collection.create_index([("room", 1), ("timestamp", -1)])
    await users_collection.create_index("username", unique=True)
