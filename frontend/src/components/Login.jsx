import React, { useState } from "react";

export default function Login({ onJoin }) {
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("general");
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const name = username.trim();
    const r = room.trim() || "general";
    if (!name) {
      setError("Please enter a display name.");
      return;
    }
    if (name.length > 32) {
      setError("Name must be under 32 characters.");
      return;
    }
    setError("");
    onJoin(name, r);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">💬</div>
        <h1>Chatterbox</h1>
        <p>Real-time chat over WebSockets. Pick a name and a room to join.</p>

        <div className="field">
          <label htmlFor="username">Display name</label>
          <input
            id="username"
            autoFocus
            placeholder="e.g. Alex"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
          />
        </div>

        <div className="field">
          <label htmlFor="room">Room</label>
          <input
            id="room"
            placeholder="general"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            maxLength={40}
          />
        </div>

        <button className="login-btn" type="submit">
          Join chat
        </button>

        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
