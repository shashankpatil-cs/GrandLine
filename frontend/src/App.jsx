import React, { useState, useEffect } from "react";
import Login from "./components/Login.jsx";
import ChatRoom from "./components/ChatRoom.jsx";

export default function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("chatSession");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const handleJoin = (username, room) => {
    const newSession = { username, room };
    setSession(newSession);
    localStorage.setItem("chatSession", JSON.stringify(newSession));
  };

  const handleLeave = () => {
    setSession(null);
    localStorage.removeItem("chatSession");
  };

  if (!session) {
    return <Login onJoin={handleJoin} />;
  }

  return (
    <ChatRoom
      username={session.username}
      room={session.room}
      onLeave={handleLeave}
    />
  );
}
