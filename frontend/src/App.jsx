import React, { useState, useEffect, useRef } from "react";
import Login from "./components/Login.jsx";
import Dashboard from "./components/Dashboard.jsx";
import ChatRoom from "./components/ChatRoom.jsx";

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

  const handleLogout = () => {
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
