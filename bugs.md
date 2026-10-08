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

---

## 4. The Production "Unseen" Bug

**The Problem Faced:**
In production, the "seen" (read receipts) feature worked flawlessly for active users chatting in real time. However, when users refreshed the page or joined a room later, historical messages didn't show who had read them, making it look like the feature was completely broken.

**The Bug Discovered:**
When fetching chat history via `/api/rooms/{room}/messages`, the backend had a fast-path that returned messages directly from the Redis cache (`room:{room}:history`). Because the backend attached read receipts *after* the caching logic but conditionally skipped it if the cache was hit, cached messages were returned bare, without their associated `readers` field populated.

**Cause:**
When a message was originally sent, it was immediately added to the Redis list cache (for lightning-fast load times). At that exact instant, the message had zero readers. Later, as users read the message, their names were added to a separate Redis set (`msg:{id}:read_by`). The history endpoint's `if cached:` short-circuit returned the original cached payload without executing the subsequent pipeline block that dynamically stitched the `msg:{id}:read_by` sets onto the returned message objects.

**Solution:**
We refactored the history fetching logic to separate the retrieval of the base messages from the attachment of the live read receipts. Now, whether the base messages are pulled from the lightning-fast Redis cache or from the MongoDB fallback, the request *always* flows through the Redis pipeline block that queries the `msg:{id}:read_by` sets and attaches the live readers to each message before returning the payload to the client.

---

## 5. The Python Scope Shadowing Bug

**The Problem Faced:**
When launching the backend server using `docker compose up --build`, the Python container crashed immediately during startup with an `UnboundLocalError: cannot access local variable 'os' where it is not associated with a value`.

**The Bug Discovered:**
In `main.py`, we added logic inside the FastAPI `lifespan` context manager to gracefully shutdown the Kafka consumer and the `asyncio` task by reading an OS environment variable: `os.environ.get("MASTER_ADMIN_USER")`. Further down in the exact same function, we had a local variable declared named `os`.

**Cause:**
Python's lexical scoping rules dictate that if you assign a value to a variable anywhere inside a function, that variable is treated as *local* to the entire function block. Because we had `os = ...` at the bottom of the function, Python considered `os` to be a local variable for the *entire* function scope. When the code at the top of the function executed `os.environ.get()`, it tried to look up the local `os` variable before it had been assigned, resulting in the fatal `UnboundLocalError`.

**Solution:**
We removed the localized `os` variable shadowing entirely. We refactored the function to ensure the global `os` module was accessible without conflict, allowing the backend to properly read the environment variables, seed the master admin account, and gracefully boot the asynchronous background tasks.
