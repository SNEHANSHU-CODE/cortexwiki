import { io } from "socket.io-client";
import { queryKnowledge } from "../utils/api";

const SOCKET_URL         = import.meta.env.VITE_SOCKET_URL         || "";
const OUTBOUND_EVENT     = import.meta.env.VITE_SOCKET_EMIT_EVENT   || "query:start";
const START_EVENT        = import.meta.env.VITE_SOCKET_START_EVENT  || "query:started";
const TOKEN_EVENT        = import.meta.env.VITE_SOCKET_TOKEN_EVENT  || "query:token";
const COMPLETE_EVENT     = import.meta.env.VITE_SOCKET_COMPLETE_EVENT || "query:complete";
const ERROR_EVENT        = import.meta.env.VITE_SOCKET_ERROR_EVENT  || "query:error";

function tokenDelay(token) {
  // BUG FIX #9: Removed artificial delay calculation
  // Streaming delay should be determined by network latency, not token length
  // Real-time token delivery provides better UX
  return 0;
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
    // BUG FIX #16: Preserve full error details and stack trace for debugging
    if (!signal?.aborted) {
      const errorData = {
        message: error?.message || "Unknown error occurred",
        status: error?.status || error?.response?.status,
        code: error?.code || "UNKNOWN_ERROR",
        details: error?.response?.data || error?.data || {},
        timestamp: new Date().toISOString(),
        stack: error?.stack,  // Include stack trace for debugging
      };
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
  let deadConnectionCheck = null;  // BUG FIX #20: Initialize to null for cleanup in all paths

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

    socket.on("connect",           () => {
      onConnectionChange?.("connected");
      
      // BUG FIX #20: Start heartbeat on connection to keep socket alive
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (socket?.connected) {
          socket.emit("ping", { timestamp: Date.now() });
        }
      }, 30000); // Send ping every 30 seconds
    });
    
    socket.on("disconnect", () => {
      onConnectionChange?.("reconnecting");
      // Clear heartbeat on disconnect
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      // BUG FIX #8: Attempt reconnection after delay
      setTimeout(() => {
        if (socket && !socket.connected) {
          socket.connect();
        }
      }, 3000);
    });
    
    socket.on("reconnect_attempt", () => onConnectionChange?.("reconnecting"));
    socket.on("connect_error",     () => {
      onConnectionChange?.("fallback");
      // BUG FIX #8: Retry socket connection on error
      setTimeout(() => {
        if (socket && !socket.connected) {
          socket.connect();
        }
      }, 5000);
    });
    
    // BUG FIX #20: Handle pong responses from server and track connection health
    let lastPongTime = Date.now();
    socket.on("pong", (data) => {
      lastPongTime = Date.now();
      // Socket is healthy, connection state is fresh
      logger?.debug?.(`Pong received at ${lastPongTime}`);
    });
    
    // BUG FIX #20: Detect dead connections if no pong within 60 seconds
    const deadConnectionCheck = setInterval(() => {
      if (socket?.connected && Date.now() - lastPongTime > 60000) {
        logger?.warn?.("Socket appears dead - no pong in 60s, disconnecting");
        socket.disconnect();
      }
    }, 30000);
    
    socket.on(START_EVENT,    (data) => onStart?.(data));
    socket.on(TOKEN_EVENT,    (data) => onToken?.(data));
    socket.on(COMPLETE_EVENT, (data) => onComplete?.(data));
    socket.on(ERROR_EVENT,    (data) => onError?.(data));

    socket.connect();
  } else {
    onConnectionChange?.("fallback");
  }

  const disconnect = () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (deadConnectionCheck) clearInterval(deadConnectionCheck);
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  };

  const send = async ({ requestId, payload, signal }) => {
    if (socket?.connected) {
      socket.emit(OUTBOUND_EVENT, { requestId, ...payload });
      return;
    }
    await streamFallbackResponse({
      payload, signal, requestId,
      onStart, onToken, onComplete, onError, onConnectionChange,
    });
  };

  return { send, disconnect };
}

export default { createChatStreamSession };