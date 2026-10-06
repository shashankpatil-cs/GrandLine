import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from 'react-markdown';
import EmojiPicker from 'emoji-picker-react';
import CryptoJS from 'crypto-js';

const API_BASE = import.meta.env.VITE_API_URL;
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

export default function ChatRoom({ username, group, token, onLeave }) {
  const room = group.name;
  const roomId = group.id;
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([username]);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);
  const [userStatuses, setUserStatuses] = useState({}); // { username: "active" | "away" }
  const [replyingTo, setReplyingTo] = useState(null);
  const [expandedSeen, setExpandedSeen] = useState({});
  const [expandedMessages, setExpandedMessages] = useState({});
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  
  // Zero-hassle E2EE: Automatically use the unique room ID as the encryption key
  const secretKey = roomId;

  const decryptMessage = (text) => {
    if (!text) return text;
    // Check if it looks like CryptoJS AES ciphertext
    if (text.startsWith("U2FsdGVkX1")) {
      if (!secretKey) return "🔒 [Encrypted Message - Enter Secret Key]";
      try {
        const bytes = CryptoJS.AES.decrypt(text, secretKey);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        return originalText || "🔒 [Failed to decrypt - Wrong Key?]";
      } catch (e) {
        return "🔒 [Failed to decrypt - Wrong Key?]";
      }
    }
    return text;
  };

  const toggleSeen = (msgId) => {
    setExpandedSeen(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const toggleMessage = (msgId) => {
    setExpandedMessages(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const remoteTypingTimeoutRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const pendingReadsRef = useRef([]);
  const isAtBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    isAtBottomRef.current = isAtBottom;
    setShowScrollBottom(!isAtBottom);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/rooms/${roomId}/messages?limit=50`,
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
  }, [roomId, token]);

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${roomId}/members`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (!isUnmountedRef.current) setMembers(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [roomId, token]);

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    const url = `${WS_BASE}/ws/${roomId}?token=${encodeURIComponent(
      token
    )}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isUnmountedRef.current) return;
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      loadHistory();
      loadMembers();
      // Announce initial status
      const initialStatus = document.visibilityState === "visible" ? "active" : "away";
      ws.send(JSON.stringify({ type: "status", status: initialStatus }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "presence") {
          setOnlineUsers(data.users);
          loadMembers(); // Reload members to update is_online status
        } else if (data.type === "typing") {
          const others = data.typists.filter(u => u !== username);
          setTypingUsers(others);
          clearTimeout(remoteTypingTimeoutRef.current);
          remoteTypingTimeoutRef.current = setTimeout(() => setTypingUsers([]), 3000);
        } else if (data.type === "clear_chat") {
          setMessages([]);
        } else if (data.type === "read_receipt") {
          setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, readers: data.readers } : m));
        } else if (data.type === "status_update") {
          setUserStatuses(data.statuses);
        } else if (data.type === "ping") {
          return; // Ignore keep-alive pings
        } else {
          if (data.username !== username && data.id) {
            if (document.visibilityState === "visible") {
              ws.send(JSON.stringify({type: "read", message_id: data.id}));
            } else {
              pendingReadsRef.current.push(data.id);
            }
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

    ws.onclose = (event) => {
      setConnected(false);
      if (isUnmountedRef.current) return;
      if (event.code === 1008) {
        console.warn("WebSocket closed due to auth or login from another location:", event.reason);
        return;
      }

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

  }, [roomId, token, loadHistory, loadMembers]);

  // Visibility change listener — registered once, not per reconnect
  useEffect(() => {
    const handleVisibilityChange = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const isVisible = document.visibilityState === "visible";
      const status = isVisible ? "active" : "away";
      ws.send(JSON.stringify({ type: "status", status }));

      if (isVisible && pendingReadsRef.current.length > 0) {
        pendingReadsRef.current.forEach(id => {
          ws.send(JSON.stringify({ type: "read", message_id: id }));
        });
        pendingReadsRef.current = [];
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

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
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, typingUsers]);

  function sendMessage(e) {
    e.preventDefault();
    let text = draft.trim();
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return;
    
    // Encrypt if we have a secret key and it's not a bot command
    if (secretKey && !text.startsWith("@ai")) {
      text = CryptoJS.AES.encrypt(text, secretKey).toString();
    }
    
    const payload = { type: "message", text };
    if (replyingTo) {
      payload.reply_to = {
        id: replyingTo.id,
        username: replyingTo.username,
        text: replyingTo.text
      };
    }
    
    wsRef.current.send(JSON.stringify(payload));
    setDraft("");
    setReplyingTo(null);
    isAtBottomRef.current = true; // Force scroll to bottom when sending a message
    setShowScrollBottom(false);
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

  async function clearChat() {
    if (group.admin !== username) return;
    try {
      await fetch(`${API_BASE}/api/groups/${roomId}/messages`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
    } catch (e) {
      console.error(e);
    }
  }

  let lastDay = null;

  return (
    <div className="chat-app">
      <div className={`sidebar-overlay ${showSidebar ? "open" : ""}`} onClick={() => setShowSidebar(false)} />
      <aside className={`sidebar ${showSidebar ? "open" : ""}`}>
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
          {(showAllUsers ? members : members.slice(0, 8)).map((m) => {
            const isAway = userStatuses[m.username] === "away";
            return (
              <div className={`user-row ${!m.is_online ? "offline" : ""}`} key={m.username} style={{ opacity: m.is_online ? (isAway ? 0.7 : 1) : 0.5 }}>
                <span className="avatar">{initials(m.username)}</span>
                <span>{m.username === username ? `${m.username} (you)` : m.username} {isAway && m.is_online && <span style={{fontSize: '12px', color: '#ffb347'}}>(away)</span>}</span>
                {m.is_online && <span className="status-dot" style={{ background: isAway ? "#ffb347" : "#4caf50" }} />}
              </div>
            );
          })}
          {members.length > 8 && (
            <button 
              onClick={() => setShowAllUsers(!showAllUsers)}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-dim)",
                fontSize: "12px",
                width: "100%",
                padding: "6px",
                borderRadius: "6px",
                marginTop: "10px",
                cursor: "pointer",
              }}
            >
              {showAllUsers ? "Show less" : `Show all (${members.length})`}
            </button>
          )}
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <button className="mobile-toggle" onClick={() => setShowSidebar(!showSidebar)}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <div>
              <h2 style={{ fontFamily: 'var(--font-pirate)', fontSize: '32px', margin: 0, fontWeight: 'normal', color: '#fff', letterSpacing: '1px' }}># {room}</h2>
              <div className="sub">{onlineUsers.length} crewmate here</div>
            </div>
          </div>

          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {group.admin === username && (
              <button className="clear-btn" onClick={clearChat} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text)' }}>Clear chat</button>
            )}
            <div className={`connection-badge ${connected ? "online" : "offline"}`}>
            <span>{connected ? "●" : "○"}</span>
            {connected ? "Connected" : "Reconnecting…"}
          </div>
          </div>
        </div>

        <div className="messages-pane" ref={scrollRef} onScroll={handleScroll}>
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
                    <div className="bubble-container">
                      {m.reply_to && (
                        <div className="replied-msg">
                          <strong>{m.reply_to.username}</strong>
                          <p>{m.reply_to.text}</p>
                        </div>
                      )}
                      <div className="bubble markdown-body" style={{
                        /* Basic overrides to make markdown look good inside a chat bubble */
                        wordBreak: 'break-word',
                        margin: 0
                      }}>
                        <ReactMarkdown>
                          {decryptMessage(m.text).length > 500 && !expandedMessages[m.id] ? `${decryptMessage(m.text).slice(0, 500)}...` : decryptMessage(m.text)}
                        </ReactMarkdown>
                        {decryptMessage(m.text).length > 500 && (
                          <button 
                            onClick={() => toggleMessage(m.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--accent)",
                              fontSize: "12px",
                              cursor: "pointer",
                              padding: "4px 0 0 0",
                              fontWeight: "bold",
                              display: "block"
                            }}
                          >
                            {expandedMessages[m.id] ? "Show less" : "Read more"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', justifyContent: mine ? 'flex-end' : 'flex-start', position: 'relative' }}>
                      <button className="action-btn" onClick={() => setReplyingTo({...m, text: decryptMessage(m.text)})} title="Reply">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
                      </button>
                      <div style={{ position: 'relative' }}>
                        <button className="action-btn" onClick={() => {
                          navigator.clipboard.writeText(decryptMessage(m.text));
                          setCopiedMsgId(m.id);
                          setTimeout(() => setCopiedMsgId(null), 2000);
                        }} title="Copy">
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                        </button>
                        {copiedMsgId === m.id && <div className="copy-popup">Copied!</div>}
                      </div>
                    </div>
                    {mine && m.readers && m.readers.filter(r => r !== username).length > 0 && (
                      <div style={{fontSize: "11px", color: "gray", marginTop: "4px", textAlign: mine ? "right" : "left"}}>
                        {!expandedSeen[m.id] ? (
                          <button 
                            onClick={() => toggleSeen(m.id)}
                            style={{
                              background: "none", 
                              border: "none", 
                              color: "var(--text-dim)", 
                              cursor: "pointer", 
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: "4px"
                            }}
                            title="See who read this"
                          >
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                          </button>
                        ) : (
                          <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--text-dim)" }}>
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                            {m.readers.filter(r => r !== username).join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          {showScrollBottom && (
            <button
              onClick={() => {
                isAtBottomRef.current = true;
                setShowScrollBottom(false);
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
              }}
              style={{
                position: "absolute",
                bottom: "100px",
                right: "20px",
                background: "var(--accent)",
                color: "#0a1922",
                border: "none",
                borderRadius: "50%",
                width: "40px",
                height: "40px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                zIndex: 10
              }}
            >
              ▼
            </button>
          )}
        </div>

        <div className="typing-row">
          {typingUsers.length > 0
            ? `${typingUsers.join(", ")} ${typingUsers.length > 1 ? "are" : "is"} typing…`
            : ""}
        </div>

        <div className="composer-container">
          {replyingTo && (
            <div className="reply-preview">
              <div className="reply-preview-content">
                <strong>Replying to {replyingTo.username}</strong>
                <p>{replyingTo.text}</p>
              </div>
              <button type="button" className="reply-cancel" onClick={() => setReplyingTo(null)}>×</button>
            </div>
          )}
          <form className="composer" onSubmit={sendMessage} style={{ position: 'relative' }}>
            {showEmojiPicker && (
              <div style={{ position: 'absolute', bottom: '100%', left: '0', zIndex: 1000, marginBottom: '10px' }}>
                <EmojiPicker 
                  onEmojiClick={(emojiData) => setDraft(prev => prev + emojiData.emoji)} 
                  theme="dark"
                  skinTonesDisabled
                  searchDisabled
                  height={350}
                  width={300}
                />
              </div>
            )}
            <button 
              type="button" 
              onClick={() => setShowEmojiPicker(!showEmojiPicker)} 
              style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', padding: '0 10px', filter: 'grayscale(0.5)' }}
            >
              😀
            </button>
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
        </div>
      </main>
    </div>
  );
}
