import React, { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL;

export default function Admin({ token, onClose }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/admin/users`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [token]);

  const handleDelete = async (username) => {
    if (!window.confirm(`Are you absolutely sure you want to delete ${username}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/auth/admin/users/${username}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to delete user");
      fetchUsers(); // refresh the list
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  return (
    <div className="login-screen op-theme" style={{ alignItems: 'flex-start', paddingTop: '40px', overflowY: 'auto' }}>
      <div className="login-card" style={{ width: '900px', maxWidth: '95%', background: 'var(--bg-panel)', border: '1px solid var(--accent)', padding: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontFamily: 'var(--font-pirate)', color: 'var(--accent)', fontSize: '32px', margin: 0 }}>Captain's Quarters (Admin Panel)</h2>
          <button onClick={onClose} style={{ background: 'var(--bg-panel-alt)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: '6px' }}>Back to Ship</button>
        </div>

        {error && <div style={{ color: 'var(--danger)', marginBottom: '10px' }}>{error}</div>}

        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '10px' }}>Pirate (User)</th>
              <th style={{ padding: '10px' }}>Status</th>
              <th style={{ padding: '10px' }}>Last IP Address</th>
              <th style={{ padding: '10px' }}>OS / Browser</th>
              <th style={{ padding: '10px' }}>Last Login</th>
              <th style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.username} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px', fontWeight: 'bold', color: u.is_admin ? 'var(--accent)' : 'var(--text)' }}>
                  {u.username} {u.is_admin && '👑'}
                </td>
                <td style={{ padding: '10px' }}>
                  {u.is_online ? <span style={{ color: 'var(--online)' }}>● Online</span> : <span style={{ color: 'var(--text-dim)' }}>○ Offline</span>}
                </td>
                <td style={{ padding: '10px', fontFamily: 'monospace' }}>{u.last_ip}</td>
                <td style={{ padding: '10px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={u.last_os_browser}>
                  {u.last_os_browser}
                </td>
                <td style={{ padding: '10px' }}>
                  {u.last_login !== 'Unknown' ? new Date(u.last_login).toLocaleString() : 'Never'}
                </td>
                <td style={{ padding: '10px', textAlign: 'right' }}>
                  {!u.is_admin && (
                    <button 
                      onClick={() => handleDelete(u.username)}
                      style={{ background: 'var(--danger)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      Banish
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
