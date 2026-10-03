# Real-Time Chat App: Bug Fixes & Technical Deep Dive

This document outlines the critical bugs faced during the development of the concurrent session architecture, detailing the problems, root causes, and technical solutions. It is structured to be an excellent reference for system design discussions and engineering interviews.

---

## 1. The "Ghost User" Presence Bug

**The Problem Faced:**
Users who logged into the app from a second device (or a new tab) would forcefully disconnect their first device. However, their username would linger indefinitely in the original chat room's "Online" list as a ghost user.

**The Bug Discovered:**
When the backend `ConnectionManager` accepted a new WebSocket connection, it correctly identified and kicked the user's old WebSocket. However, the manual eviction process removed the old connection from the application's memory *before* the server's standard disconnection cleanup could run.

**Cause:**
In Python, we were manually mutating the active connections dictionary (`connections.pop(old_ws)`) to remove the old WebSocket right before closing it. When the `await old_ws.close()` command completed, it triggered a `WebSocketDisconnect` exception that routed to the `disconnect()` cleanup function. Because the WebSocket reference was already missing from the dictionary, the backend assumed the user was already gone and completely bypassed the `_delayed_disconnect` cleanup logic. As a result, the Redis commands meant to remove the user from the global presence list (`room:{room}:users`) were never executed.

**Solution:**
We removed the manual dictionary mutation. Instead, we simply issue the `close()` command to the old WebSocket and allow it to naturally trigger the `WebSocketDisconnect` event. This elegantly routes the forced eviction through the exact same standard disconnection pipeline used for network drops, ensuring all Redis presence and status keys are accurately purged.

---

## 2. The Session Eviction Suicide Bug

**The Problem Faced:**
To enforce a strict "one active device per user" rule, we added a "Force Log In" button. When Device B used this to log in, Device A was successfully kicked out. However, shortly after, Device B would mysteriously lose its session lock and be asked to log in again.

**The Bug Discovered:**
The background cleanup logic designed to gracefully log out the *old* device (Device A) was inadvertently reaching into Redis and destroying the session lock belonging to the *new* device (Device B).

**Cause:**
When Device A was forcefully evicted from the system, its frontend continued to send a background heartbeat ping every 15 seconds. This ping failed with a `401 Unauthorized`. The frontend reacted correctly by automatically running its `handleLogout()` function to clean up local state, which made an API call to the backend `/logout` endpoint using Device A's old JWT token.
The backend `/logout` endpoint decoded the JWT, read the username, and blindly deleted the active `user_session:{username}` key from Redis. Because it did not verify *which* session it was deleting, it effectively destroyed Device B's brand-new session lock.

**Solution:**
We added Session ID (`sid`) validation to the `/logout` endpoint. Now, before deleting the Redis session lock, the backend extracts the `sid` from the user's JWT and verifies that it matches the current `sid` stored in Redis. If they don't match (meaning the request came from an old, evicted token), the delete operation is ignored, preserving the new device's session.

---

## 3. The Infinite Reconnect Loop

**The Problem Faced:**
When a user was forcefully logged out (because they connected on a different tab), the old tab would quietly spin in the background, making endless, rapid WebSocket connection attempts and flooding the backend with unauthorized requests.

**The Bug Discovered:**
The frontend `ChatRoom` component featured aggressive auto-reconnect logic to handle spotty internet connections. However, this logic failed to distinguish between a temporary network drop and a deliberate server-side eviction.

**Cause:**
The frontend's `ws.onclose` event handler treated all disconnections equally. When the backend forcibly closed the duplicate connection, it sent a custom WebSocket close code (`1008: Policy Violation - New connection opened elsewhere`). The frontend ignored this code and immediately initiated its exponential backoff reconnect loop. 

**Solution:**
We added an explicit intercept in the `ws.onclose` listener for the `1008` close code. If this specific code is detected, the frontend logs a warning to the console and aborts the auto-reconnect loop entirely, gracefully accepting the eviction and saving system resources.
