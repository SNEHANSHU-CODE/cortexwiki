import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import MessageBubble from "../components/MessageBubble";
import { createChatStreamSession } from "../services/chatStream";
import {
  addUserMessage,
  appendAssistantChunk,
  clearChatError,
  clearMessages,
  failAssistantMessage,
  finishAssistantMessage,
  setChatError,
  setConnectionState,
  startAssistantMessage,
} from "../redux/slices/chatSlice";
import "./styles/Workspace.css";

const QUICK_PROMPTS = [
  "Summarize the main concepts in my latest source.",
  "Which ideas are the most central?",
  "What concepts still need more evidence?",
];

function extractErrorMessage(err) {
  if (!err) return "Unable to generate an answer.";
  if (typeof err === "string") return err;
  return err.response?.data?.error?.message || err.message || "Unable to generate an answer.";
}

function ConnPill({ state }) {
  const labels = { connected: "Live", reconnecting: "Reconnecting…", fallback: "HTTP" };
  return (
    <span
      className={`ws-conn-pill ws-conn-pill--${state}`}
      aria-label={`Connection: ${state}`}
      title={state === "connected" ? "Socket live" : state === "reconnecting" ? "Reconnecting…" : "HTTP fallback"}
    >
      {labels[state] ?? state}
    </span>
  );
}

/**
 * ChatPage — accepts wikiId prop when embedded in WikiDashboard.
 * No page header, no outer padding — fills its parent container.
 */
function ChatPage({ wikiId }) {
  const [input, setInput] = useState("");
  const [debug, setDebug] = useState(false);
  const dispatch          = useDispatch();
  const { accessToken }   = useSelector((s) => s.auth);
  const { messages, pendingMessageId, status, error, connectionState } =
    useSelector((s) => s.chat);

  const sessionRef      = useRef(null);
  const abortRef        = useRef(null);
  const lastPromptRef   = useRef(null);
  const scrollAnchorRef = useRef(null);
  const textareaRef     = useRef(null);

  // ── Session ──────────────────────────────────────────────────────────────
  useEffect(() => {
    sessionRef.current = createChatStreamSession({
      token: accessToken,
      onConnectionChange: (s) => dispatch(setConnectionState(s)),
      onStart:    ({ requestId }) =>
        dispatch(startAssistantMessage({ id: requestId, createdAt: new Date().toISOString() })),
      onToken:    ({ requestId, chunk }) =>
        dispatch(appendAssistantChunk({ id: requestId, chunk })),
      onComplete: ({ requestId, content, metadata }) =>
        dispatch(finishAssistantMessage({ id: requestId, content, metadata })),
      onError: (err) => {
        const msg = extractErrorMessage(err);
        const rid = lastPromptRef.current?.requestId;
        dispatch(setChatError(msg));
        if (rid) dispatch(failAssistantMessage({
          id: rid, error: msg,
          content: "I ran into an issue generating that answer.",
        }));
      },
    });
    return () => { sessionRef.current?.disconnect(); abortRef.current?.abort(); };
  }, [accessToken, dispatch]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: messages.length > 1 ? "smooth" : "auto",
      block: "end",
    });
  }, [messages, pendingMessageId]);

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const submitPrompt = useCallback(async (question) => {
    const trimmed = question.trim();
    if (!trimmed || pendingMessageId || !wikiId) return;

    const requestId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    abortRef.current?.abort();
    abortRef.current      = new AbortController();
    lastPromptRef.current = { question: trimmed, debug, requestId };

    dispatch(clearChatError());
    dispatch(addUserMessage({ id: `${requestId}-user`, role: "user", content: trimmed, createdAt }));
    setInput("");

    try {
      await sessionRef.current?.send({
        requestId,
        payload: { question: trimmed, wiki_id: wikiId, debug },
        signal:  abortRef.current.signal,
      });
    } catch (err) {
      if (abortRef.current?.signal.aborted) return;
      const msg = extractErrorMessage(err);
      dispatch(setChatError(msg));
      dispatch(failAssistantMessage({
        id: requestId, error: msg,
        content: "I ran into an issue generating that answer.",
      }));
    }
  }, [debug, dispatch, pendingMessageId, wikiId]);

  const handleSubmit = (e) => { e.preventDefault(); void submitPrompt(input); };
  const handleRetry  = () => { if (lastPromptRef.current?.question) void submitPrompt(lastPromptRef.current.question); };
  const handleQuick  = (p) => { startTransition(() => setInput(p)); textareaRef.current?.focus(); };

  const isStreaming = status === "streaming";

  return (
    <div className="chat-embed">

      {/* ── Top meta bar ─────────────────────────────────────────────── */}
      <div className="chat-embed__meta">
        <div className="chat-embed__meta-left">
          <span className="ws-eyebrow">Conversation</span>
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="chat-embed__meta-right">
          <ConnPill state={connectionState} />
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ fontSize: "0.72rem", padding: "0.2rem 0.6rem" }}
            onClick={() => dispatch(clearMessages())}
            disabled={messages.length === 0}
          >
            Clear
          </button>
          <label className="ws-checkbox" style={{ fontSize: "0.72rem" }}>
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
            />
            Debug
          </label>
        </div>
      </div>

      {/* ── Quick prompts ─────────────────────────────────────────────── */}
      {messages.length === 0 && (
        <div className="chat-embed__quickbar">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              className="chat-embed__quick-btn"
              onClick={() => handleQuick(p)}
              disabled={!wikiId}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ── Message stream ────────────────────────────────────────────── */}
      <div
        className="chat-embed__stream"
        role="log"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.length === 0 && (
          <div className="ws-empty" style={{ minHeight: 200 }}>
            <span className="ws-empty__icon">💬</span>
            <h3>{wikiId ? "Ask a grounded question" : "Select a wiki to begin"}</h3>
            <p>
              {wikiId
                ? "Every answer is grounded in this wiki's knowledge base."
                : "Pick a wiki from the left panel first."}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRetry={msg.status === "error" ? handleRetry : undefined}
          />
        ))}
        <div ref={scrollAnchorRef} aria-hidden="true" />
      </div>

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <div className="ws-banner ws-banner--error" style={{ margin: "0 1rem" }} role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Composer ──────────────────────────────────────────────────── */}
      <div className="chat-embed__composer">
        <form onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="chatInput">Ask CortexWiki</label>
          <div className="ws-composer">
            <textarea
              ref={textareaRef}
              id="chatInput"
              className="ws-composer__textarea"
              placeholder={
                wikiId
                  ? "Ask a grounded question about this wiki…"
                  : "Select a wiki to start chatting…"
              }
              value={input}
              rows={1}
              disabled={!wikiId}
              onChange={(e) => { dispatch(clearChatError()); setInput(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitPrompt(input);
                }
              }}
            />
            <div className="ws-composer__footer">
              <span className="ws-composer__hint">↵ send · ⇧↵ new line</span>
              <button
                type="submit"
                className="ws-btn ws-btn--primary"
                disabled={!wikiId || !input.trim() || isStreaming}
                aria-busy={isStreaming}
              >
                {isStreaming ? "Streaming…" : "Send →"}
              </button>
            </div>
          </div>
        </form>
      </div>

    </div>
  );
}

export default ChatPage;