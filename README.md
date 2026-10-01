# 🏴‍☠️ Grandline Chat

A fully-featured, real-time chat application inspired by One Piece. Built with FastAPI (WebSockets), React, and MongoDB, this app provides a seamless and persistent chat experience for users sailing the Grand Line.

## 🌟 Features
- **Real-time Messaging:** Lightning-fast WebSocket communication broadcasting messages instantly to crewmates.
- **Persistent Chat History:** All messages are securely saved to MongoDB. History is automatically fetched when joining or reconnecting.
- **Clear Chat:** Wipes room history from the database and instantly synchronizes the clear event across all connected clients.
- **Smart Reconnection:** Built-in WebSocket reconnection logic with exponential backoff to handle network drops smoothly.
- **Session Persistence:** Login state is saved in `localStorage`, keeping users in their chat rooms even after a page refresh.
- **Live Presence & Typing Indicators:** See who is currently aboard and who is actively typing.
- **One Piece Theme:** Custom nautical UI featuring rolling CSS waves, a Thousand Sunny graphic, and 'Pirata One' typography.

## 🛠️ Tech Stack
- **Frontend:** React + Vite, raw CSS (no UI frameworks)
- **Backend:** Python + FastAPI, native WebSockets, Motor (async MongoDB driver)
- **Database:** MongoDB
- **Deployment:** Fully Dockerized, `docker-compose` orchestration, `.env` management, dynamic port bindings ready for PaaS (Render, Heroku).

## 🚀 Run Locally with Docker

1. Ensure Docker is installed and running.
2. Clone the repository.
3. Spin up the containers:

```bash
docker compose up --build
```

- **Frontend UI:** `http://localhost:5173`
- **Backend API:** `http://localhost:8000`
- **MongoDB Database:** Safely exposed on `mongodb://localhost:27018` for local inspection (e.g., via MongoDB Compass).

Open the frontend in multiple browser tabs, choose the same room name, and start chatting!

## 🚢 Deployment Ready

This repository is optimized for modern deployment stacks (e.g., Render + Vercel + MongoDB Atlas). 
- **Configuration:** No hardcoded secrets. Uses `.env` for environment variables.
- **Portability:** The backend dynamically binds to the `$PORT` environment variable.
- **Secure WebSockets:** The frontend automatically upgrades `http://` to `https://` and `ws://` to `wss://` in production.

## 📁 Project Structure
```text
grandline/
├── docker-compose.yml
├── backend/              # FastAPI Python backend
│   ├── .env              # Environment configuration
│   ├── Dockerfile        # Production-ready Dockerfile (dynamic $PORT)
│   ├── requirements.txt
│   └── app/
│       ├── main.py       # REST + WebSocket endpoints
│       ├── database.py   # Motor client
│       └── ...
└── frontend/             # React + Vite frontend
    ├── Dockerfile        # Multi-stage Nginx static build
    ├── package.json
    └── src/
        ├── App.jsx       # Session management
        ├── index.css     # Theme & Animations
        └── components/
            └── ChatRoom.jsx
```
