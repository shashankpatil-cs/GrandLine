import os
import json
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
import redis.asyncio as redis
from datetime import datetime

KAFKA_URL = os.environ["KAFKA_URL"]
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
REDIS_URL = os.environ["REDIS_URL"]

async def run_worker():
    print("Starting DB Worker...", flush=True)
    
    # Connect to MongoDB
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    messages_collection = db["messages"]

    # Connect to Kafka
    consumer = AIOKafkaConsumer(
        "chat.messages.new",
        bootstrap_servers=KAFKA_URL,
        group_id="db_writer_group", # Fixed group ID so it acts like a work queue!
        auto_offset_reset="latest",  # Only process NEW messages, not old ones on restart
        value_deserializer=lambda m: json.loads(m.decode('utf-8'))
    )
    
    await consumer.start()
    print("DB Worker listening for messages on 'chat.messages.new'...", flush=True)
    
    try:
        async for msg in consumer:
            doc = msg.value
            
            # Convert string timestamp back to datetime for proper MongoDB querying
            if "timestamp" in doc and isinstance(doc["timestamp"], str):
                try:
                    ts_str = doc["timestamp"].replace("Z", "+00:00")
                    doc["timestamp"] = datetime.fromisoformat(ts_str)
                except Exception:
                    pass
            
            try:
                await messages_collection.insert_one(doc)
                print(f"✅ Saved message {doc.get('_id')} from {doc.get('username')} to MongoDB", flush=True)
            except Exception as e:
                print(f"❌ Error saving to MongoDB: {e}", flush=True)
                
    finally:
        await consumer.stop()

if __name__ == "__main__":
    
    async def consume_reads():
        print("Starting Reads Batch Worker...", flush=True)
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        producer = AIOKafkaProducer(bootstrap_servers=KAFKA_URL)
        await producer.start()
        
        consumer_reads = AIOKafkaConsumer(
            "chat.reads",
            bootstrap_servers=KAFKA_URL,
            group_id="db_writer_reads",
            auto_offset_reset="latest",  # Only process NEW reads on restart
            value_deserializer=lambda m: json.loads(m.decode('utf-8'))
        )
        await consumer_reads.start()
        
        try:
            while True:
                # Get up to 1000 reads, waiting up to 1000ms
                data = await consumer_reads.getmany(timeout_ms=1000, max_records=1000)
                if not data:
                    continue
                
                reads_batch = {}
                for tp, messages in data.items():
                    for msg in messages:
                        doc = msg.value
                        mid = doc.get("message_id")
                        uname = doc.get("username")
                        rm = doc.get("room")
                        if mid and uname:
                            if mid not in reads_batch:
                                reads_batch[mid] = {"room": rm, "users": set()}
                            reads_batch[mid]["users"].add(uname)
                
                if not reads_batch:
                    continue
                    
                # 1. Batch execute all SADD commands in one single round-trip!
                pipe = redis_client.pipeline()
                for mid, info in reads_batch.items():
                    pipe.sadd(f"msg:{mid}:read_by", *list(info["users"]))
                await pipe.execute()
                
                # 2. Fetch the updated lists for broadcast
                pipe = redis_client.pipeline()
                for mid in reads_batch.keys():
                    pipe.smembers(f"msg:{mid}:read_by")
                results = await pipe.execute()
                
                # 3. Broadcast to all active chat servers
                for idx, mid in enumerate(reads_batch.keys()):
                    room = reads_batch[mid]["room"]
                    readers = list(results[idx])
                    payload = {
                        "type": "read_receipt",
                        "message_id": mid,
                        "readers": sorted(readers),
                        "room": room
                    }
                    await producer.send_and_wait("chat_broadcast", json.dumps(payload).encode('utf-8'))
                
                print(f"✅ Processed batch of {sum(len(info['users']) for info in reads_batch.values())} read receipts", flush=True)
                
        except Exception as e:
            print(f"❌ Error in reads batching: {e}", flush=True)
        finally:
            await consumer_reads.stop()
            await producer.stop()
            await redis_client.close()

    async def main():
        # Run both the Mongo writer and the Read Receipts batcher at the same time
        await asyncio.gather(
            run_worker(),
            consume_reads()
        )

    asyncio.run(main())
