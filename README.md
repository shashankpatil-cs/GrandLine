<div align="center">
  <img src="https://img.icons8.com/color/96/000000/one-piece.png" alt="One Piece Logo" width="100"/>
  <h1>🏴‍☠️ Grandline Chat</h1>
  <p><i>A fully-featured, real-time chat application inspired by One Piece.</i></p>
  
  <p>
    <img src="https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi" alt="FastAPI" />
    <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
    <img src="https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  </p>
</div>

<br/>

Built with **FastAPI (WebSockets)**, **React**, and **MongoDB**, this app provides a seamless and persistent chat experience for users sailing the Grand Line.

## ✨ Features

- ⚡ **Real-time Messaging:** Lightning-fast WebSocket communication broadcasting messages instantly to crewmates.
- 💾 **Persistent Chat History:** All messages are securely saved to MongoDB. History is automatically fetched when joining or reconnecting.
- 🧹 **Clear Chat:** Wipes room history from the database and instantly synchronizes the clear event across all connected clients.
- 🔄 **Smart Reconnection:** Built-in WebSocket reconnection logic with exponential backoff to handle network drops smoothly.
- 🍪 **Session Persistence:** Login state is saved securely, keeping users in their chat rooms even after a page refresh.
- 🟢 **Live Presence & Typing Indicators:** See who is currently aboard and who is actively typing.
- 🎨 **One Piece Theme:** Custom nautical UI featuring rolling CSS waves, a Thousand Sunny graphic, and 'Pirata One' typography.

## 🛠️ Tech Stack

| Frontend | Backend | Infrastructure |
|----------|---------|----------------|
| React + Vite | Python + FastAPI | MongoDB |
| Raw CSS (No UI Frameworks) | Native WebSockets | Redis |
| | PyJWT, Motor (Async) | Docker & Docker Compose |

## 🚀 Run Locally

1. Ensure **Docker** is installed and running.
2. Clone the repository.
3. Spin up the containers:

```bash
docker compose up --build
```

### 📍 Services
- **Frontend UI:** `http://localhost:5173`
- **Backend API:** `http://localhost:8000`
- **MongoDB Database:** `mongodb://localhost:27018`
- **Redis Cache:** `localhost:6379`

Open the frontend in multiple browser tabs, choose the same room name, and start chatting!

## 🔐 Authentication API

Users must register and log in to get access. Refresh tokens are securely stored in Redis.

- `POST /api/auth/register` - Create an account
- `POST /api/auth/login` - Login and get JWT access & refresh tokens
- `POST /api/auth/refresh` - Swap a refresh token for a new access token
- `POST /api/auth/logout` - Invalidate the refresh token in Redis

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
