import os
import json
import asyncio
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer

KAFKA_URL = os.getenv("KAFKA_URL", "kafka:9092")

producer = None
consumer_task = None

async def init_kafka(local_broadcast_callback):
    global producer, consumer_task
    
    producer = AIOKafkaProducer(bootstrap_servers=KAFKA_URL)
    await producer.start()

    # Unique group_id for each backend instance ensures all instances receive the broadcast!
    group_id = f"chat_backend_{os.urandom(4).hex()}"
    consumer = AIOKafkaConsumer(
        "chat_broadcast",
        bootstrap_servers=KAFKA_URL,
        group_id=group_id,
        auto_offset_reset="latest" # Only care about live messages
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

async def publish_broadcast(payload: dict):
    if producer:
        await producer.send_and_wait("chat_broadcast", json.dumps(payload).encode('utf-8'))

async def publish_db_write(payload: dict):
    if producer:
        await producer.send_and_wait("chat.messages.new", json.dumps(payload).encode('utf-8'))

async def publish_read_receipt(payload: dict):
    if producer:
        await producer.send_and_wait("chat.reads", json.dumps(payload).encode('utf-8'))

async def close_kafka():
    if producer:
        await producer.stop()
    if consumer_task:
        consumer_task.cancel()
