import React, { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function Login({ onJoin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [room, setRoom] = useState("general");
  const [error, setError] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const name = username.trim();
    const pass = password.trim();
    const r = room.trim() || "general";
    if (!name || !pass) {
      setError("Please enter a username and password.");
      return;
    }
    if (name.length > 32) {
      setError("Name must be under 32 characters.");
      return;
    }
    setError("");

    try {
      if (isRegistering) {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: name, password: pass })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || "Registration failed");
        }
        const data = await res.json();
        onJoin(name, r, data.access_token);
      } else {
        const formData = new URLSearchParams();
        formData.append("username", name);
        formData.append("password", pass);
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formData.toString()
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || "Login failed");
        }
        const data = await res.json();
        onJoin(name, r, data.access_token);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">💬</div>
        <h1>Chatterbox</h1>
        <p>Real-time chat over WebSockets. Pick a name and a room to join.</p>

        <div className="field">
          <label htmlFor="username">Username</label>
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
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

        <button className="login-btn" type="submit" style={{marginBottom: "10px"}}>
          {isRegistering ? "Register" : "Login"}
        </button>

        <a 
          href="#" 
          onClick={(e) => { e.preventDefault(); setIsRegistering(!isRegistering); }}
          style={{ fontSize: "14px", color: "var(--accent)", textAlign: "center", display: "block" }}
        >
          {isRegistering ? "Already have an account? Login" : "Need an account? Register"}
        </a>

        {error && <div className="login-error" style={{marginTop: "10px"}}>{error}</div>}
      </form>
    </div>
  );
}
