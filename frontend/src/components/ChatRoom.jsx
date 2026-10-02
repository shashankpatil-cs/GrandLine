import React, { useEffect, useRef, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function timeLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Today";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatRoom({ username, room, token, onLeave }) {
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([username]);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);

  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const remoteTypingTimeoutRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isUnmountedRef = useRef(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/rooms/${encodeURIComponent(room)}/messages?limit=50`,
        {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to load history: ${res.status}`);
      }
      const data = await res.json();
      if (isUnmountedRef.current) return;

      setMessages((prev) => {
        const map = new Map();
        for (const m of prev) {
          const key = m.id || `${m.type}-${m.timestamp}-${m.username}`;
          map.set(key, m);
        }
        for (const m of data) {
          const key = m.id || `${m.type}-${m.timestamp}-${m.username}`;
          map.set(key, m);
        }
        return Array.from(map.values()).sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );
      });
    } catch (err) {
      console.error("Failed to load history", err);
    }
  }, [room, token]);

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    const url = `${WS_BASE}/ws/${encodeURIComponent(room)}?username=${encodeURIComponent(
      username
    )}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isUnmountedRef.current) return;
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      loadHistory();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "presence") {
          setOnlineUsers(data.users);
        } else if (data.type === "typing") {
          const others = data.typists.filter(u => u !== username);
          setTypingUsers(others);
          clearTimeout(remoteTypingTimeoutRef.current);
          remoteTypingTimeoutRef.current = setTimeout(() => setTypingUsers([]), 3000);
        } else if (data.type === "clear_chat") {
          setMessages([]);
        } else if (data.type === "read_receipt") {
          setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, readers: data.readers } : m));
        } else {
          if (data.username !== username && data.id) {
            ws.send(JSON.stringify({type: "read", message_id: data.id}));
          }
          setMessages((prev) => {
            const key = data.id || `${data.type}-${data.timestamp}-${data.username}`;
            if (
              prev.some(
                (m) =>
                  (m.id && m.id === data.id) ||
                  (m.timestamp === data.timestamp &&
                    m.username === data.username &&
                    m.text === data.text)
              )
            ) {
              return prev;
            }
            return [...prev, data];
          });
        }
      } catch (err) {
        console.error("Error processing websocket message", err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (isUnmountedRef.current) return;

      const baseDelay = 1000;
      const maxDelay = 15000;
      const attempt = reconnectAttemptsRef.current;
      const backoff = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
      const jitter = Math.random() * 1000;
      const delay = Math.round(backoff + jitter);

      reconnectAttemptsRef.current += 1;
      reconnectRef.current = setTimeout(() => {
        if (!isUnmountedRef.current) {
          connect();
        }
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [room, username, loadHistory]);

  useEffect(() => {
    isUnmountedRef.current = false;
    setMessages([]);
    reconnectAttemptsRef.current = 0;
    connect();

    return () => {
      isUnmountedRef.current = true;
      clearTimeout(reconnectRef.current);
      clearTimeout(remoteTypingTimeoutRef.current);
      clearTimeout(typingTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typingUsers]);

  function sendMessage(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "message", text }));
    setDraft("");
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }

  function handleDraftChange(e) {
    setDraft(e.target.value);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (!typingTimeoutRef.current) {
        wsRef.current.send(JSON.stringify({ type: "typing" }));
        typingTimeoutRef.current = setTimeout(() => {
          typingTimeoutRef.current = null;
        }, 2000);
      }
    }
  }

  function clearChat() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "clear_chat" }));
    }
  }

  let lastDay = null;

  return (
    <div className="chat-app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="logo-dot" style={{ background: 'transparent', border: '2px solid var(--accent)', borderRadius: '50%', color: 'var(--accent)', fontSize: '18px' }}>🧭</div>
            <span style={{ fontFamily: 'var(--font-pirate)', fontSize: '28px', color: 'var(--accent)', letterSpacing: '1px' }}>Grandline</span>
          </div>
          <div className="room-pill" style={{ background: 'var(--bg-panel-alt)', borderColor: 'var(--border)' }}>
            <span style={{ fontFamily: 'var(--font-pirate)', fontSize: '18px', color: '#fff' }}># {room}</span>
            <span style={{ color: '#0ab7b0' }}>{onlineUsers.length} aboard</span>
          </div>
        </div>

        <div className="sidebar-section">
          <h3 style={{ fontFamily: 'var(--font-pirate)', fontSize: '20px', color: '#e7e9f5', textTransform: 'none', letterSpacing: '1px' }}>Crew on deck</h3>
          {onlineUsers.map((u) => (
            <div className="user-row" key={u}>
              <span className="avatar">{initials(u)}</span>
              <span>{u === username ? `${u} (you)` : u}</span>
              <span className="status-dot" />
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="avatar">{initials(username)}</span>
          <span>{username}</span>
          <button className="leave-btn" onClick={onLeave}>
            Leave
          </button>
        </div>
      </aside>

      <main className="chat-main">
        <div className="chat-header" style={{ position: 'relative', paddingBottom: '24px' }}>
          <div className="wave-container">
            <div className="wave2"></div>
            <div className="wave"></div>
            <svg className="thousand-sunny" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <path d="M15,70 L25,90 L75,90 L90,60 L80,60 L65,80 L30,80 Z" fill="#8B4513"/>
              <rect x="50" y="10" width="4" height="70" fill="#4a2e15"/>
              <path d="M30,20 Q50,15 70,20 L75,55 Q50,65 25,55 Z" fill="#fff"/>
              <path d="M38,18 L48,16 L50,60 L40,59 Z" fill="#d32f2f"/>
              <path d="M60,18 L70,20 L62,56 L55,59 Z" fill="#d32f2f"/>
              <circle cx="90" cy="55" r="12" fill="#FFA500"/>
              <circle cx="90" cy="55" r="7" fill="#FFD700"/>
              <path d="M54,10 L70,5 L54,18 Z" fill="#222"/>
            </svg>
          </div>
          <div>
            <h2 style={{ fontFamily: 'var(--font-pirate)', fontSize: '32px', margin: 0, fontWeight: 'normal', color: '#fff', letterSpacing: '1px' }}># {room}</h2>
            <div className="sub">{onlineUsers.length} crewmate here</div>
          </div>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="clear-btn" onClick={clearChat} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text)' }}>Clear chat</button>
            <div className={`connection-badge ${connected ? "online" : "offline"}`}>
            <span>{connected ? "●" : "○"}</span>
            {connected ? "Connected" : "Reconnecting…"}
          </div>
          </div>
        </div>

        <div className="messages-pane" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', marginTop: 'auto', marginBottom: 'auto' }}>
              <svg width="100" height="100" viewBox="0 0 100 100" style={{ marginBottom: '15px' }}>
                <path d="M52 20 L52 55 L80 55 Z" fill="#f1e0c5"/>
                <path d="M48 20 L48 55 L20 55 Z" fill="#2c9a8f"/>
                <path d="M20 60 Q 50 80 80 60 L80 65 Q 50 85 20 65 Z" fill="#d96745"/>
                <path d="M10 70 Q 30 60 50 70 T 90 70" fill="none" stroke="#2c9a8f" strokeWidth="3"/>
                <path d="M15 80 Q 35 70 55 80 T 95 80" fill="none" stroke="#2c9a8f" strokeWidth="2" opacity="0.6"/>
                <rect x="49" y="15" width="2" height="45" fill="#8c644c"/>
              </svg>
              <h3 style={{ fontFamily: 'var(--font-pirate)', fontSize: '28px', color: 'var(--text)', margin: '0 0 8px 0', fontWeight: 'normal', letterSpacing: '1px' }}>The sea is quiet</h3>
              <p style={{ margin: 0, fontSize: '13px' }}>No messages yet. Set sail and say hello.</p>
            </div>
          )}

          {messages.map((m) => {
            const showDivider = dayLabel(m.timestamp) !== lastDay;
            lastDay = dayLabel(m.timestamp);

            if (m.type === "system") {
              return (
                <React.Fragment key={m.id}>
                  {showDivider && (
                    <div className="day-divider">
                      <span>{dayLabel(m.timestamp)}</span>
                    </div>
                  )}
                  <div className="system-row">
                    <span>{m.text}</span>
                  </div>
                </React.Fragment>
              );
            }

            const mine = m.username === username;
            return (
              <React.Fragment key={m.id}>
                {showDivider && (
                  <div className="day-divider">
                    <span>{dayLabel(m.timestamp)}</span>
                  </div>
                )}
                <div className={`msg-row ${mine ? "mine" : ""}`}>
                  <span className="avatar">{initials(m.username)}</span>
                  <div className="msg-body">
                    {!mine && (
                      <div className="msg-meta">
                        {m.username} · {timeLabel(m.timestamp)}
                      </div>
                    )}
                    {mine && <div className="msg-meta">{timeLabel(m.timestamp)}</div>}
                    <div className="bubble">{m.text}</div>
                    {m.readers && m.readers.filter(r => r !== username).length > 0 && (
                      <div style={{fontSize: "11px", color: "gray", marginTop: "4px", textAlign: mine ? "right" : "left"}}>
                        👁️ {m.readers.filter(r => r !== username).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="typing-row">
          {typingUsers.length > 0
            ? `${typingUsers.join(", ")} ${typingUsers.length > 1 ? "are" : "is"} typing…`
            : ""}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            placeholder={`Message #${room}`}
            value={draft}
            onChange={handleDraftChange}
            maxLength={2000}
          />
          <button className="send-btn" type="submit" disabled={!draft.trim() || !connected} style={{ width: 'auto', padding: '0 20px', background: 'var(--accent)', color: '#0a1922', fontWeight: '600' }}>
            Send ➤
          </button>
        </form>
      </main>
    </div>
  );
}
