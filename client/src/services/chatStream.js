import { io } from "socket.io-client";
import { queryKnowledge } from "../utils/api";

const SOCKET_URL         = import.meta.env.VITE_SOCKET_URL         || "";
const OUTBOUND_EVENT     = import.meta.env.VITE_SOCKET_EMIT_EVENT   || "query:start";
const START_EVENT        = import.meta.env.VITE_SOCKET_START_EVENT  || "query:started";
const TOKEN_EVENT        = import.meta.env.VITE_SOCKET_TOKEN_EVENT  || "query:token";
const COMPLETE_EVENT     = import.meta.env.VITE_SOCKET_COMPLETE_EVENT || "query:complete";
const ERROR_EVENT        = import.meta.env.VITE_SOCKET_ERROR_EVENT  || "query:error";

function tokenDelay(token) {
  // BUG FIX #9: Implement proper streaming delay for realistic token-by-token delivery
  // Previous code returned 0, causing all tokens to arrive at once in HTTP fallback
  // Now: calculate delay based on token length + random variance for natural feel
  // Token delay = base (10ms) + length factor (5ms per char) + random jitter (±5ms)
  if (!token) return 0;
  const baseDelay = 10;  // Base 10ms per token
  const lengthDelay = Math.min(token.length * 5, 60);  // 5ms per char, max 60ms
  const jitter = (Math.random() - 0.5) * 10;  // ±5ms random variation
  const totalDelay = Math.max(5, baseDelay + lengthDelay + jitter);
  return Math.round(totalDelay);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenize(text) {
  return text.match(/\S+\s*|\n+/g) ?? [];
}

async function streamFallbackResponse({
  payload,
  signal,
  requestId,
  onStart,
  onToken,
  onComplete,
  onError,
  onConnectionChange,
}) {
  try {
    onConnectionChange?.("fallback");
    const result = await queryKnowledge(payload, { signal });
    if (signal?.aborted) return;

    onStart?.({ requestId, transport: "http" });

    const tokens = tokenize(result.answer ?? "");
    let assembled = "";

    for (const token of tokens) {
      if (signal?.aborted) return;
      assembled += token;
      onToken?.({ requestId, chunk: token, content: assembled });
      await wait(tokenDelay(token));
    }

    if (!signal?.aborted) {
      onComplete?.({ requestId, content: result.answer, metadata: result });
    }
  } catch (error) {
    // BUG FIX #11: Don't expose stack traces to client - only send user-safe error info
    if (!signal?.aborted) {
      // Limit details size to prevent Redux state bloat
      let details = error?.response?.data || error?.data || {};
      const detailsStr = JSON.stringify(details);
      if (detailsStr.length > 500) {
        details = { message: "Error details too large to display" };
      }
      
      const errorData = {
        message: error?.message || "Unknown error occurred",
        status: error?.status || error?.response?.status,
        code: error?.code || "UNKNOWN_ERROR",
        details: details,
        timestamp: new Date().toISOString(),
        // BUG FIX #11: Don't include stack trace in client state (only log to console in dev)
      };
      
      // Log full error including stack to console for debugging (dev only)
      if (typeof console !== "undefined" && import.meta.env.MODE !== "production") {
        console.error("[ChatStream Error]", error);
      }
      
      onError?.(errorData);
    }
  }
}

export function createChatStreamSession({
  token,
  onConnectionChange,
  onStart,
  onToken,
  onComplete,
  onError,
}) {
  let socket = null;
  let heartbeatInterval = null;
  let deadConnectionCheck = null;  // BUG FIX #3: Initialize to null for cleanup in all paths
  
  // Tracks in-flight emit watchdogs: requestId → timeoutId
  const _emitWatchdogs = new Map();


  if (SOCKET_URL) {
    socket = io(SOCKET_URL, {
      autoConnect:          false,
      transports:           ["websocket", "polling"],
      auth:                 token ? { token } : undefined,
      withCredentials:      true,
      reconnection:         true,
      reconnectionAttempts: 5,
      reconnectionDelay:    1_000,
      reconnectionDelayMax: 5_000,
    });

    let lastPongTime = Date.now();

    socket.on("connect",           () => {
      onConnectionChange?.("connected");
      
      // BUG FIX #3: Clear existing interval before creating new one to prevent leak
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (socket?.connected) {
          socket.emit("app_ping", { timestamp: Date.now() });
        }
      }, 30000); // Send ping every 30 seconds

      // BUG FIX #3: Clear and restart connection health monitor on reconnect
      if (deadConnectionCheck) clearInterval(deadConnectionCheck);
      lastPongTime = Date.now();
      deadConnectionCheck = setInterval(() => {
        if (socket?.connected && Date.now() - lastPongTime > 60000) {
          console.warn("Socket appears dead - no pong in 60s, disconnecting");
          socket.disconnect();
        }
      }, 30000);
    });
    
    socket.on("disconnect", () => {
      onConnectionChange?.("reconnecting");
      // BUG FIX #3: Clear heartbeat on disconnect
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      // BUG FIX #3: Clear dead connection check on disconnect
      if (deadConnectionCheck) {
        clearInterval(deadConnectionCheck);
        deadConnectionCheck = null;
      }
    });
    
    socket.on("reconnect_attempt", () => onConnectionChange?.("reconnecting"));
    socket.on("connect_error",     () => {
      onConnectionChange?.("fallback");
    });
    
    // BUG FIX #3: Handle pong responses from server and track connection health
    socket.on("app_pong", () => {
      lastPongTime = Date.now();
      // Socket is healthy, connection state is fresh
    });
    
    socket.on(START_EVENT, (data) => {
      // Clear watchdog — server acknowledged the request
      const watchdog = _emitWatchdogs.get(data?.requestId);
      if (watchdog) {
        clearTimeout(watchdog);
        _emitWatchdogs.delete(data?.requestId);
      }
      onStart?.(data);
    });
    socket.on(TOKEN_EVENT,    (data) => onToken?.(data));
    socket.on(COMPLETE_EVENT, (data) => onComplete?.(data));
    socket.on(ERROR_EVENT,    (data) => onError?.(data));

    socket.connect();
  } else {
    onConnectionChange?.("fallback");
  }

  const disconnect = () => {
    _emitWatchdogs.forEach((id) => clearTimeout(id));
    _emitWatchdogs.clear();
    // BUG FIX #3: Properly clean up all intervals and listeners to prevent memory leaks
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (deadConnectionCheck) {
      clearInterval(deadConnectionCheck);
      deadConnectionCheck = null;
    }
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  };

  const updateToken = (newToken) => {
    if (socket) {
      const tokenChanged = socket.auth?.token !== newToken;
      socket.auth = newToken ? { token: newToken } : undefined;
      if (tokenChanged && !socket.connected) {
        // Reconnect with updated credentials
        socket.connect();
      } else if (tokenChanged && socket.connected) {
        // Gracefully reconnect to re-authenticate with new token
        socket.disconnect();
        socket.connect();
      }
    }
  };

  const send = async ({ requestId, payload, signal }) => {
    if (socket?.connected) {
      socket.emit(OUTBOUND_EVENT, { requestId, ...payload });
      // Watchdog: if server doesn't acknowledge with query:started within 10s,
      // fall back to HTTP so the UI doesn't stay stuck.
      const watchdog = setTimeout(async () => {
        _emitWatchdogs.delete(requestId);
        if (signal?.aborted) return;
        console.warn("[ChatStream] No server ack for requestId=%s — falling back to HTTP", requestId);
        onError?.({
          message: "Connection timed out. Retrying over HTTP…",
          code: "SOCKET_TIMEOUT",
          timestamp: new Date().toISOString(),
        });
        await streamFallbackResponse({ payload, signal, requestId, onStart, onToken, onComplete, onError, onConnectionChange });
      }, 10_000);
      _emitWatchdogs.set(requestId, watchdog);
      return;
    }
    await streamFallbackResponse({
      payload, signal, requestId,
      onStart, onToken, onComplete, onError, onConnectionChange,
    });
  };

  return { send, disconnect, updateToken };
}

export default { createChatStreamSession };