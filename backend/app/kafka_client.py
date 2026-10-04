import os
import json
import asyncio
import ssl
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer

KAFKA_URL = os.environ["KAFKA_URL"]
KAFKA_USER = os.environ.get("KAFKA_USER")
KAFKA_PASSWORD = os.environ.get("KAFKA_PASSWORD")

producer = None
consumer_task = None

def get_kafka_kwargs():
    if KAFKA_USER:
        context = ssl.create_default_context(cafile="ca.pem") if os.path.exists("ca.pem") else ssl.create_default_context()
        return {
            "bootstrap_servers": KAFKA_URL,
            "security_protocol": "SASL_SSL",
            "sasl_mechanism": "SCRAM-SHA-256",
            "sasl_plain_username": KAFKA_USER,
            "sasl_plain_password": KAFKA_PASSWORD,
            "ssl_context": context
        }
    return {"bootstrap_servers": KAFKA_URL}
async def init_kafka(local_broadcast_callback):
    global producer, consumer_task
    
    producer = AIOKafkaProducer(**get_kafka_kwargs())
    await producer.start()

    # Unique group_id for each backend instance ensures all instances receive the broadcast!
    group_id = f"chat_backend_{os.urandom(4).hex()}"
    consumer = AIOKafkaConsumer(
        "chat_broadcast",
        group_id=group_id,
        auto_offset_reset="latest", # Only care about live messages
        **get_kafka_kwargs()
    )
    await consumer.start()

    async def consume():
        try:
            async for msg in consumer:
                try:
                    payload = json.loads(msg.value.decode('utf-8'))
                    room = payload.get("room")
                    if room and payload:
                        await local_broadcast_callback(room, payload)
                except Exception as e:
                    print(f"Kafka consume error: {e}")
        finally:
            await consumer.stop()

    consumer_task = asyncio.create_task(consume())

from bson import ObjectId
from datetime import datetime

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)

async def publish_broadcast(payload: dict):
    if producer:
        await producer.send_and_wait("chat_broadcast", json.dumps(payload, cls=CustomJSONEncoder).encode('utf-8'))

async def publish_db_write(payload: dict):
    if producer:
        await producer.send_and_wait("chat.messages.new", json.dumps(payload, cls=CustomJSONEncoder).encode('utf-8'))

async def publish_read_receipt(payload: dict):
    if producer:
        await producer.send_and_wait("chat.reads", json.dumps(payload, cls=CustomJSONEncoder).encode('utf-8'))

async def close_kafka():
    if producer:
        await producer.stop()
    if consumer_task:
        consumer_task.cancel()
