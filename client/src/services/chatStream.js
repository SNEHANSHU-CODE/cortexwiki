import { io } from "socket.io-client";
import { queryKnowledge } from "../utils/api";

const SOCKET_URL         = import.meta.env.VITE_SOCKET_URL         || "";
const OUTBOUND_EVENT     = import.meta.env.VITE_SOCKET_EMIT_EVENT   || "query:start";
const START_EVENT        = import.meta.env.VITE_SOCKET_START_EVENT  || "query:started";
const TOKEN_EVENT        = import.meta.env.VITE_SOCKET_TOKEN_EVENT  || "query:token";
const COMPLETE_EVENT     = import.meta.env.VITE_SOCKET_COMPLETE_EVENT || "query:complete";
const ERROR_EVENT        = import.meta.env.VITE_SOCKET_ERROR_EVENT  || "query:error";

function tokenDelay(token) {
  return Math.min(60, 12 + token.length * 4);
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
    if (!signal?.aborted) {
      onError?.(error);
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

    socket.on("connect",           () => onConnectionChange?.("connected"));
    socket.on("disconnect",        () => onConnectionChange?.("reconnecting"));
    socket.on("reconnect_attempt", () => onConnectionChange?.("reconnecting"));
    socket.on("connect_error",     () => onConnectionChange?.("fallback"));
    socket.on(START_EVENT,    (data) => onStart?.(data));
    socket.on(TOKEN_EVENT,    (data) => onToken?.(data));
    socket.on(COMPLETE_EVENT, (data) => onComplete?.(data));
    socket.on(ERROR_EVENT,    (data) => onError?.(data));

    socket.connect();
  } else {
    onConnectionChange?.("fallback");
  }

  const disconnect = () => {
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