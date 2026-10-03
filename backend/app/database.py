import os
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as redis

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

messages_collection = db["messages"]
users_collection = db["users"]
groups_collection = db["groups"]
group_members_collection = db["group_members"]

REDIS_URL = os.environ["REDIS_URL"]
redis_client = redis.from_url(REDIS_URL, decode_responses=True)


async def init_db():
    await messages_collection.create_index([("room", 1), ("timestamp", -1)])
    await users_collection.create_index("username", unique=True)
    await groups_collection.create_index("join_code", unique=True)
    await group_members_collection.create_index([("group_id", 1), ("username", 1)], unique=True)
