<div align="center">
  <img src="https://img.icons8.com/color/96/000000/one-piece.png" alt="One Piece Logo" width="100"/>
  <h1>🏴‍☠️ Grandline Chat</h1>
  <p><i>A fully-featured, real-time, end-to-end encrypted chat application inspired by One Piece.</i></p>
  
  <p>
    <img src="https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi" alt="FastAPI" />
    <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
    <img src="https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
    <img src="https://img.shields.io/badge/Kafka-231F20?style=for-the-badge&logo=apachekafka&logoColor=white" alt="Kafka" />
  </p>
</div>

<br/>

Built with **FastAPI (WebSockets)**, **React**, **MongoDB**, **Redis**, and **Kafka**, this app provides a highly scalable and resilient chat experience for users sailing the Grand Line.

## ✨ Features

- ⚡ **Real-time Messaging:** Lightning-fast WebSocket communication broadcasting messages instantly to crewmates.
- 🔒 **True End-to-End Encryption (E2EE):** All messages are AES-256 encrypted automatically on the client side using crypto-js. The server never sees your raw messages.
- 📨 **Offline Notifications:** In-app unread badges intelligently calculate how many new messages are waiting for you while you were away.
- 👑 **Master Admin Dashboard:** Dedicated admin portal to monitor analytics, active devices, and delete malicious users.
- 📱 **Mobile Responsive:** Beautiful responsive UI with a slide-in sidebar for seamless chatting on mobile devices.
- 💾 **Kafka Event Streaming:** Background database writes are offloaded to an Apache Kafka message queue and processed by a dedicated worker, allowing the API to return responses instantly.
- 🔄 **Smart Reconnection:** Built-in WebSocket reconnection logic with exponential backoff to handle network drops smoothly.
- 🟢 **Live Presence & Typing Indicators:** See who is currently aboard and who is actively typing.

## 🛠️ Tech Stack

| Frontend | Backend | Infrastructure |
|----------|---------|----------------|
| React + Vite | Python + FastAPI | MongoDB |
| Raw CSS (No UI Frameworks) | Native WebSockets | Redis |
| Crypto-JS (AES-256) | PyJWT, Motor (Async) | Docker & Apache Kafka |

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
- **Kafka Broker:** `localhost:9092`

Open the frontend in multiple browser tabs, choose the same room name, and start chatting!

## 🔐 Authentication API

Users must register and log in to get access. Refresh tokens are securely stored in Redis. Strict concurrency locks prevent the same user from chatting on multiple devices simultaneously.

- `POST /api/auth/register` - Create an account
- `POST /api/auth/login` - Login and get JWT access & refresh tokens
- `POST /api/auth/refresh` - Swap a refresh token for a new access token
- `POST /api/auth/logout` - Invalidate the refresh token in Redis

## 🚢 Deployment Ready

This repository is optimized for modern deployment stacks (e.g., Render + Vercel + MongoDB Atlas). 

- **Configuration:** No hardcoded secrets. Uses `.env` for environment variables.
- **Portability:** The backend dynamically binds to the `$PORT` environment variable.
- **Secure WebSockets:** The frontend automatically upgrades `http://` to `https://` and `ws://` to `wss://` in production.
- **Admin Seeding:** Add `MASTER_ADMIN_USER` and `MASTER_ADMIN_PASS` to automatically seed an admin portal upon deployment.

## 📁 Project Structure

```text
grandline/
├── docker-compose.yml
├── backend/              # FastAPI Python backend
│   ├── Dockerfile        # Production-ready Dockerfile (dynamic $PORT)
│   ├── db_worker.py      # Kafka consumer for async DB writes
│   └── app/
│       ├── main.py       # REST + WebSocket endpoints
│       └── connection_manager.py
└── frontend/             # React + Vite frontend
    ├── Dockerfile        # Multi-stage Nginx static build
    └── src/
        ├── App.jsx       # Routing & Session management
        ├── index.css     # Nautical Theme & Animations
        └── components/
            ├── ChatRoom.jsx
            └── Dashboard.jsx
```
