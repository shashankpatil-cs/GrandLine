import React, { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function Dashboard({ username, token, onSelectRoom, onLogout }) {
  const [groups, setGroups] = useState([]);
  const [joinCode, setJoinCode] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [whoCanJoin, setWhoCanJoin] = useState("invite");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [requests, setRequests] = useState({});

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/groups`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        
        // Fetch requests for groups where user is admin
        for (const g of data) {
          if (g.admin === username) {
            const reqRes = await fetch(`${API_BASE}/api/groups/${g.id}/requests`, {
              headers: { "Authorization": `Bearer ${token}` }
            });
            if (reqRes.ok) {
              const reqData = await reqRes.json();
              setRequests(prev => ({ ...prev, [g.id]: reqData }));
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [token, username]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  async function handleJoin(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/groups/join?join_code=${encodeURIComponent(joinCode)}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (!res.ok) throw new Error(data.detail || "Failed to join");
      setMessage(data.message);
      setJoinCode("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/groups?name=${encodeURIComponent(newGroupName)}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (!res.ok) throw new Error(data.detail || "Failed to create group");
      setNewGroupName("");
      setDescription("");
      fetchGroups();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleApprove(groupId, reqUsername) {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${groupId}/requests/${encodeURIComponent(reqUsername)}/approve`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      fetchGroups();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleReject(groupId, reqUsername) {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${groupId}/requests/${encodeURIComponent(reqUsername)}/reject`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      fetchGroups();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="dashboard-container op-theme">
      {/* Background Waves */}
      <div className="op-waves">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path fill="#546571" fillOpacity="1" d="M0,256L48,229.3C96,203,192,149,288,149.3C384,149,480,203,576,213.3C672,224,768,192,864,181.3C960,171,1056,181,1152,176C1248,171,1344,149,1392,138.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        </svg>
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path fill="#04568c" fillOpacity="1" d="M0,192L48,197.3C96,203,192,213,288,197.3C384,181,480,139,576,144C672,149,768,203,864,229.3C960,256,1056,256,1152,240C1248,224,1344,192,1392,176L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        </svg>
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path fill="#022a4f" fillOpacity="1" d="M0,288L48,272C96,256,192,224,288,213.3C384,203,480,213,576,218.7C672,224,768,224,864,208C960,192,1056,160,1152,149.3C1248,139,1344,149,1392,154.7L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        </svg>
      </div>

      <button className="logout-btn" onClick={onLogout}>
        <span style={{ fontSize: '14px' }}>⚓</span> Logout ({username})
      </button>

      <div className="dash-header">
        <div className="dash-title-row">
          <div className="dash-hat">
            <div className="dash-hat-top"></div>
            <div className="dash-hat-ribbon"></div>
            <div className="dash-hat-brim"></div>
          </div>
          <h1>Grandline chat</h1>
        </div>
        <p className="dash-subtitle">Welcome aboard. Join a crew or start your own.</p>
      </div>

      <div className="dash-grid">
        
        {/* Left Column: Join Group */}
        <div className="dash-column">
          <div className="dash-col-header">Join group</div>
          <div className="dash-card">
            
            <form onSubmit={handleJoin}>
              <div className="dash-card-title">
                <span className="dash-card-icon">☸</span>
                <span>Join a crew</span>
              </div>
              <p className="dash-card-desc">Enter the invite code a crewmate sent you.</p>

              <div className="op-field">
                <label>Invite code</label>
                <input
                  placeholder="e.g. SUNNY-4821"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value)}
                />
              </div>

              {message && <div style={{ color: '#2ed573', fontWeight: 'bold', marginBottom: '10px' }}>{message}</div>}
              {error && <div className="op-error">{error}</div>}

              <button className="op-btn-primary" type="submit" style={{width: '100%'}}>Join group</button>
            </form>

            <div className="op-divider"></div>
            
            <div className="op-field">
              <label>Your crews</label>
            </div>
            
            <div className="dash-list">
              {groups.length === 0 ? (
                <p className="dash-card-desc" style={{textAlign: 'center'}}>You are not in any crews yet.</p>
              ) : (
                groups.map(g => (
                  <div key={g.id}>
                    <div className="dash-list-item">
                      <div className="dash-list-info">
                        <h4>{g.name}</h4>
                        <p>{g.admin === username ? "Admin" : "Member"}</p>
                      </div>
                      <button className="dash-btn-small" onClick={() => onSelectRoom(g)}>Enter</button>
                    </div>

                    {/* Admin Tools inline */}
                    {g.admin === username && (
                      <div className="dash-admin-panel">
                        <div><strong>Invite Code:</strong> {g.join_code}</div>
                        {requests[g.id] && requests[g.id].length > 0 && (
                          <div style={{marginTop: '8px'}}>
                            <strong>Pending:</strong>
                            {requests[g.id].map(req => (
                              <div key={req.id} className="dash-req-row">
                                <span>{req.username}</span>
                                <div>
                                  <button onClick={() => handleApprove(g.id, req.username)} style={{ background: '#2ed573', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: '4px', marginRight: '5px', cursor: 'pointer' }}>✓</button>
                                  <button onClick={() => handleReject(g.id, req.username)} style={{ background: '#ff6b6b', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}>✗</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

          </div>
        </div>

        {/* Right Column: Create Group */}
        <div className="dash-column">
          <div className="dash-col-header">Create group</div>
          <div className="dash-card">
            
            <form onSubmit={handleCreate}>
              <div className="dash-card-title">
                <span className="dash-card-icon">⚑</span>
                <span>Start a crew</span>
              </div>
              <p className="dash-card-desc">Name your group and choose who can find it.</p>

              <div className="op-field">
                <label>Group name</label>
                <input
                  placeholder="e.g. Night watch"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  maxLength={32}
                />
              </div>

              <div className="op-field">
                <label>Description</label>
                <input
                  placeholder="What is this crew about?"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>

              <div className="op-field">
                <label>Who can join</label>
                <div className="dash-toggle-group">
                  <button 
                    type="button" 
                    className={`dash-toggle-btn ${whoCanJoin === 'invite' ? 'active' : ''}`}
                    onClick={() => setWhoCanJoin('invite')}
                  >
                    Invite only
                  </button>
                  <button 
                    type="button" 
                    className={`dash-toggle-btn ${whoCanJoin === 'open' ? 'active' : ''}`}
                    onClick={() => setWhoCanJoin('open')}
                  >
                    Open to all
                  </button>
                </div>
              </div>

              <p className="dash-card-desc" style={{fontSize: '13px', marginTop: '-10px'}}>
                Members need your invite code to join. You'll get it after creating the group.
              </p>

              <button className="op-btn-primary" type="submit" style={{width: '100%', marginTop: '10px'}}>
                Create group
              </button>
            </form>

          </div>
        </div>

      </div>
    </div>
  );
}
