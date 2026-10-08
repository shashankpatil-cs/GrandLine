import json
import os
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import openai

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from bson import ObjectId

from .database import messages_collection, init_db, redis_client, group_members_collection, users_collection
from .models import serialize_message
from .connection_manager import manager
from .auth import router as auth_router, get_current_user, get_user_from_token
from .kafka_client import init_kafka, close_kafka
from .groups import router as groups_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    
    # Seed master admin
    admin_user = os.environ.get("MASTER_ADMIN_USER")
    admin_pass = os.environ.get("MASTER_ADMIN_PASS")
    if admin_user and admin_pass:
        from .auth import get_password_hash
        existing_admin = await users_collection.find_one({"username": admin_user})
        if not existing_admin:
            await users_collection.insert_one({"username": admin_user, "hashed_password": get_password_hash(admin_pass), "is_admin": True})
            
    # Clear stale online presence, user sessions, and statuses from previous runs
    stale_keys = await redis_client.keys("room:*:users")
    if stale_keys:
        await redis_client.delete(*stale_keys)
    stale_sessions = await redis_client.keys("user_session:*")
    if stale_sessions:
        await redis_client.delete(*stale_sessions)
    stale_statuses = await redis_client.keys("status:*")
    if stale_statuses:
        await redis_client.delete(*stale_statuses)
    # Hook up Kafka consumer to manager's local broadcast function
    await init_kafka(manager.local_broadcast)
    
    # Run the background workers directly inside the Web Service!
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        from db_worker import run_worker, consume_reads
        worker_task = asyncio.create_task(run_worker())
        reads_task = asyncio.create_task(consume_reads())
    except ImportError:
        worker_task = None
        reads_task = None
        
    yield
    
    if worker_task: worker_task.cancel()
    if reads_task: reads_task.cancel()
    await close_kafka()


app = FastAPI(title="Simple Chat", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(groups_router)

cors_origins_raw = os.environ["CORS_ORIGINS"]
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
    # Verify membership
    membership = await group_members_collection.find_one({"group_id": room, "username": user["username"], "status": "approved"})
    if not membership:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Not authorized to view messages in this group")

    cached = await redis_client.lrange(f"room:{room}:history", 0, -1)
    if cached:
        messages = [json.loads(m) for m in cached]
    else:
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


async def save_message(room: str, username: str, text: str, reply_to: dict = None) -> dict:
    from .kafka_client import publish_db_write
    
    doc = {
        "_id": str(ObjectId()),
        "room": room,
        "username": username,
        "text": text,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": "message",
    }
    
    if reply_to:
        doc["reply_to"] = reply_to
    
    # 1. Throw it onto the Kafka belt for the background script to save!
    await publish_db_write(doc)
    
    msg = serialize_message(doc)
    
    # 2. Keep the instant Redis cache so the chat feels incredibly fast
    await redis_client.rpush(f"room:{room}:history", json.dumps(msg))
    await redis_client.ltrim(f"room:{room}:history", -30, -1)
    
    return msg


async def get_weather(location: str):
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"https://wttr.in/{location}?format=3")
            if resp.status_code == 200:
                return resp.text
            return "Could not fetch weather data."
    except Exception as e:
        return f"Error: {e}"


async def generate_gpt_response(room: str, prompt: str):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        msg = await save_message(room, "GPT-Bot", "I am unable to answer right now: OPENAI_API_KEY is not set.")
        from .connection_manager import manager
        await manager.broadcast(room, msg)
        return

    try:
        from .connection_manager import manager
        # Show typing indicator
        await manager.broadcast(room, {"type": "typing", "room": room, "typists": ["GPT-Bot"]})
        
        model_name = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        client = openai.AsyncOpenAI(api_key=api_key)
        
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get the current weather for a specific location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {"type": "string", "description": "The city and state, e.g., San Francisco, CA"}
                        },
                        "required": ["location"]
                    }
                }
            },
            {
                "type": "web_search"
            }
        ]
        
        from .database import redis_client
        import json
        raw_history = await redis_client.lrange(f"room:{room}:history", -10, -1)
        
        messages = [
            {"role": "system", "content": "You are a helpful chat assistant called GPT-Bot in a group chat app called GrandLine. Keep your answers concise and helpful. You have access to tools for weather and web search. The conversation history is provided below."}
        ]
        
        for rh in raw_history:
            try:
                m = json.loads(rh)
                if m.get("type") == "message" and m.get("text"):
                    role = "assistant" if m.get("username") == "GPT-Bot" else "user"
                    prefix = f"{m['username']}: " if role == "user" else ""
                    messages.append({"role": role, "content": prefix + m["text"]})
            except Exception:
                pass
                
        # If the latest prompt isn't in history yet due to race conditions, append it manually
        if len(messages) == 1 or messages[-1]["role"] != "user" or prompt not in messages[-1]["content"]:
            messages.append({"role": "user", "content": prompt})
        
        response = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            tools=tools,
            tool_choice="auto",
            max_completion_tokens=4096
        )
        
        response_message = response.choices[0].message
        
        if response_message.tool_calls:
            import json
            messages.append(response_message)
            for tool_call in response_message.tool_calls:
                function_name = tool_call.function.name
                function_args = json.loads(tool_call.function.arguments)
                
                if function_name == "get_weather":
                    function_response = await get_weather(function_args.get("location"))
                else:
                    function_response = "Unknown function call"
                    
                messages.append({
                    "tool_call_id": tool_call.id,
                    "role": "tool",
                    "name": function_name,
                    "content": function_response,
                })
                
            second_response = await client.chat.completions.create(
                model=model_name,
                messages=messages,
                max_completion_tokens=4096
            )
            answer = second_response.choices[0].message.content
        else:
            answer = response_message.content
            
        msg = await save_message(room, "GPT-Bot", answer)
        await manager.broadcast(room, msg)
        
    except Exception as e:
        from .connection_manager import manager
        msg = await save_message(room, "GPT-Bot", f"Oops! I ran into an error: {str(e)}")
        await manager.broadcast(room, msg)


@app.websocket("/ws/{room}")
async def websocket_endpoint(websocket: WebSocket, room: str, token: str = Query(...)):
    try:
        user = await get_user_from_token(token)
    except Exception:
        await websocket.close(code=1008, reason="Unauthorized")
        return
        
    username = user["username"]
    
    # Verify membership
    membership = await group_members_collection.find_one({"group_id": room, "username": username, "status": "approved"})
    if not membership:
        await websocket.close(code=1008, reason="Not an approved member")
        return

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
                reply_to = data.get("reply_to")
                if not text:
                    continue
                
                # --- Rate Limiting (5 messages per 3 seconds, per room) ---
                rate_key = f"rate_limit:{username}:{room}"
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
                
                msg = await save_message(room, username, text[:2000], reply_to)
                await manager.broadcast(room, msg)
                
                # --- GPT BOT FEATURE ---
                if text.startswith("@ai "):
                    prompt = text[len("@ai "):].strip()
                    if prompt:
                        asyncio.create_task(generate_gpt_response(room, prompt))

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
                    from .kafka_client import publish_read_receipt
                    await publish_read_receipt({
                        "message_id": message_id,
                        "username": username,
                        "room": room
                    })

            elif event_type == "status":
                status = data.get("status")
                if status in ["active", "away"]:
                    # Save status to redis with an expiry so it doesn't linger forever
                    await redis_client.setex(f"status:{room}:{username}", 3600, status)
                    
                    status_keys = await redis_client.keys(f"status:{room}:*")
                    statuses = {}
                    if status_keys:
                        values = await redis_client.mget(status_keys)
                        for key, val in zip(status_keys, values):
                            uname = key.split(":")[-1]
                            statuses[uname] = val
                            
                    await manager.broadcast(
                        room,
                        {"type": "status_update", "room": room, "statuses": statuses}
                    )

    except WebSocketDisconnect:
        manager.disconnect(room, websocket)

