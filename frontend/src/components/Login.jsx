import React, { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function Login({ onAuth }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false);

  async function handleForceLogin() {
    const name = username.trim();
    const pass = password.trim();
    setError("");
    try {
      const formData = new URLSearchParams();
      formData.append("username", name);
      formData.append("password", pass);
      const res = await fetch(`${API_BASE}/api/auth/login?force=true`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString()
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Force login failed");
      }
      const data = await res.json();
      setIsAlreadyLoggedIn(false);
      onAuth(name, data.access_token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const name = username.trim();
    const pass = password.trim();
    
    if (!name || !pass) {
      setError("Please fill in all required fields.");
      return;
    }
    if (/\s/.test(name)) {
      setError("Username cannot contain spaces.");
      return;
    }
    if (isRegistering && pass !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (name.length > 32) {
      setError("Name must be under 32 characters.");
      return;
    }
    setError("");
    setIsAlreadyLoggedIn(false);

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
        onAuth(name, data.access_token);
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
          if (res.status === 409 || (data.detail && data.detail.includes("already logged in"))) {
            setIsAlreadyLoggedIn(true);
          }
          throw new Error(data.detail || "Login failed");
        }
        const data = await res.json();
        onAuth(name, data.access_token);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-screen op-theme">
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

      <div className="op-card-wrapper">
        <div className="op-strawhat">
          <div className="op-strawhat-top"></div>
          <div className="op-strawhat-ribbon"></div>
          <div className="op-strawhat-brim"></div>
        </div>

        <div className="op-card">
          <div className="op-tabs">
            <button 
              type="button" 
              className={`op-tab ${!isRegistering ? 'active' : ''}`}
              onClick={() => {
                setIsRegistering(false);
                setError("");
              }}
            >
              Log in
            </button>
            <button 
              type="button" 
              className={`op-tab ${isRegistering ? 'active' : ''}`}
              onClick={() => {
                setIsRegistering(true);
                setError("");
              }}
            >
              Sign up
            </button>
          </div>
          <div className="op-tabs-divider"></div>

          <form onSubmit={handleSubmit} className="op-form">
            <h1 className="op-title">{isRegistering ? "Join the crew" : "Welcome back, pirate"}</h1>
            <p className="op-subtitle">
              {isRegistering ? "Create an account to set sail with your crewmates." : "Log in to rejoin your rooms."}
            </p>

            <div className="op-field">
              <label htmlFor="username">{isRegistering ? "Username" : "Username or email"}</label>
              <input
                id="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={32}
              />
            </div>

            {isRegistering && (
              <div className="op-field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            <div className="op-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {isRegistering && (
              <div className="op-field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            )}

            {error && (
              <div className="op-error">
                <div>{error}</div>
                {isAlreadyLoggedIn && !isRegistering && (
                  <button
                    type="button"
                    onClick={handleForceLogin}
                    style={{
                      marginTop: "10px",
                      padding: "8px 12px",
                      background: "#d63737",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      width: "100%",
                      fontFamily: "var(--font)"
                    }}
                  >
                    Force Log In Here (Disconnect other session)
                  </button>
                )}
              </div>
            )}

            <button className="op-btn-primary" type="submit">
              {isRegistering ? "Create account" : "Log in"}
            </button>

            <div className="op-footer">
              <span>{isRegistering ? "Already have an account?" : "New to the crew?"}</span>
              <button 
                type="button" 
                className="op-btn-link"
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setError("");
                }}
              >
                {isRegistering ? "Log In" : "Sign up"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
