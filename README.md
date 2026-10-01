# Chatterbox — Simple WebSocket Chat

A minimal real-time chat app: FastAPI + WebSockets backend, MongoDB for message
history, and a clean React UI.

## Stack
- **Backend:** FastAPI, native WebSockets, Motor (async MongoDB driver)
- **Frontend:** React + Vite, plain CSS (no UI framework)
- **Database:** MongoDB (stores messages, used for history on join)
- **Orchestration:** Docker Compose

## Run it

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API health check: http://localhost:8000/api/health

Open the frontend in two browser tabs (or two browsers), pick the same room
name, and chat between them in real time.

## How it works

- Each browser opens a WebSocket to `/ws/{room}?username={name}`.
- The backend keeps an in-memory map of connections per room
  (`ConnectionManager`) and broadcasts every message to everyone in that room.
- Chat messages are saved to MongoDB, and `/api/rooms/{room}/messages` returns
  the last 50 messages when someone joins or reconnects.
- Join/leave and typing events are broadcast transiently over WebSockets
  without persisting to the database, keeping chat history clean.
- Presence (the online-users list) is recomputed and broadcast whenever
  someone joins or disconnects.

## Project structure

```
chat-app/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py               # FastAPI app, REST + WebSocket routes
│       ├── connection_manager.py # tracks live WebSocket connections/rooms
│       ├── models.py             # Pydantic models + Mongo doc serialization
│       └── database.py           # Motor/MongoDB client
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        └── components/
            ├── Login.jsx
            └── ChatRoom.jsx
```

## Running without Docker (dev mode)

**Backend** (needs a local or remote MongoDB at `mongodb://localhost:27017`):
```bash
cd backend
pip install -r requirements.txt
MONGO_URL=mongodb://localhost:27017 uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Phase 2 ideas (not included here, kept simple on purpose)
- Redis for pub/sub so the backend can scale across multiple instances,
  presence tracking, and per-user rate limiting.
- Celery + Redis/RabbitMQ for background jobs like push notifications,
  email digests, or message moderation.
- Auth (JWT or session-based) instead of a free-text display name.
