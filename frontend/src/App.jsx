import React, { useState, useEffect, useRef } from "react";
import Login from "./components/Login.jsx";
import Dashboard from "./components/Dashboard.jsx";
import ChatRoom from "./components/ChatRoom.jsx";

const API_BASE = import.meta.env.VITE_API_URL;

export default function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("chatSession");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return null; }
    }
    return null;
  });

  const [currentGroup, setCurrentGroup] = useState(() => {
    const savedGroup = sessionStorage.getItem("currentGroup");
    if (savedGroup) {
      try { return JSON.parse(savedGroup); } catch (e) { return null; }
    }
    return null;
  });

  const currentGroupRef = useRef(currentGroup);
  useEffect(() => { currentGroupRef.current = currentGroup; }, [currentGroup]);

  // On first mount, push a sentinel "home" entry so there's always a history
  // entry behind the chat room, preventing the browser from leaving the site.
  useEffect(() => {
    window.history.pushState({ page: "sentinel" }, "");
  }, []);

  // Save currentGroup to sessionStorage whenever it changes
  useEffect(() => {
    if (currentGroup) {
      sessionStorage.setItem("currentGroup", JSON.stringify(currentGroup));
    } else {
      sessionStorage.removeItem("currentGroup");
    }
  }, [currentGroup]);

  // Send periodic heartbeats to keep the active session alive
  useEffect(() => {
    if (!session?.token) return;

    const sendHeartbeat = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/heartbeat`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.token}`
          }
        });
        if (res.status === 401) {
          alert("Your session has ended because this account logged in on another device.");
          handleLogout();
        }
      } catch (err) {
        console.error("Heartbeat error", err);
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 15000);
    return () => clearInterval(interval);
  }, [session?.token]);

  // Release session immediately when tab is closed
  useEffect(() => {
    if (!session?.token) return;

    const releaseSession = () => {
      const url = `${API_BASE}/api/auth/release-session?token=${encodeURIComponent(session.token)}`;
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
      } else {
        fetch(url, { method: "POST", keepalive: true }).catch(() => {});
      }
    };

    window.addEventListener("pagehide", releaseSession);
    return () => window.removeEventListener("pagehide", releaseSession);
  }, [session?.token]);

  // Intercept ALL back/forward navigation via popstate
  useEffect(() => {
    const handlePopState = (e) => {
      const group = currentGroupRef.current;
      if (group) {
        // Immediately push state back to the room before the confirm dialog blocks the thread
        // This ensures that even if they spam back, there's always history ahead of them.
        window.history.pushState({ page: "inroom" }, "", `#${group.id}`);
        
        const confirmLeave = window.confirm("Are you sure you want to leave this crew?");
        if (confirmLeave) {
          setCurrentGroup(null);
          window.history.pushState({ page: "sentinel" }, "");
        }
      } else {
        // Not in a room: re-push the sentinel so the back button never
        // escapes to the browser homepage
        window.history.pushState({ page: "sentinel" }, "");
      }
    };

    const handleBeforeUnload = (e) => {
      if (currentGroupRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const handleAuth = (username, token) => {
    const newSession = { username, token };
    setSession(newSession);
    localStorage.setItem("chatSession", JSON.stringify(newSession));
  };

  const handleLogout = async () => {
    if (session?.token) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.token}`
          }
        });
      } catch (e) {
        console.error("Logout error", e);
      }
    }
    setSession(null);
    setCurrentGroup(null);
    localStorage.removeItem("chatSession");
    sessionStorage.removeItem("currentGroup");
    window.history.pushState({ page: "sentinel" }, "", window.location.pathname);
  };

  const handleSelectRoom = (group) => {
    setCurrentGroup(group);
    // Push a new history entry for the room so back button has somewhere to go
    window.history.pushState({ page: "inroom", groupId: group.id }, "", `#${group.id}`);
  };

  const handleLeaveRoom = () => {
    const confirmLeave = window.confirm("Are you sure you want to leave this crew?");
    if (confirmLeave) {
      setCurrentGroup(null);
      window.history.pushState({ page: "sentinel" }, "", window.location.pathname);
    }
  };

  if (!session) {
    return <Login onAuth={handleAuth} />;
  }

  if (!currentGroup) {
    return (
      <Dashboard
        username={session.username}
        token={session.token}
        onSelectRoom={handleSelectRoom}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <ChatRoom
      username={session.username}
      group={currentGroup}
      token={session.token}
      onLeave={handleLeaveRoom}
    />
  );
}
