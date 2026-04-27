import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
  "Which ideas in the graph are the most central?",
  "What concepts still need more evidence?",
];

function extractErrorMessage(err) {
  if (!err) return "Unable to generate an answer.";
  if (typeof err === "string") return err;
  return err.response?.data?.error?.message || err.message || "Unable to generate an answer.";
}

function ConnPill({ state }) {
  const labels = {
    connected:    "Socket live",
    reconnecting: "Reconnecting…",
    fallback:     "HTTP fallback",
  };
  return (
    <span className={`ws-conn-pill ws-conn-pill--${state}`} aria-label={`Connection: ${state}`}>
      {labels[state] ?? state}
    </span>
  );
}

function ChatPage() {
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
      onStart: ({ requestId }) =>
        dispatch(startAssistantMessage({ id: requestId, createdAt: new Date().toISOString() })),
      onToken: ({ requestId, chunk }) =>
        dispatch(appendAssistantChunk({ id: requestId, chunk })),
      onComplete: ({ requestId, content, metadata }) =>
        dispatch(finishAssistantMessage({ id: requestId, content, metadata })),
      onError: (err) => {
        const msg = extractErrorMessage(err);
        const rid = lastPromptRef.current?.requestId;
        dispatch(setChatError(msg));
        if (rid) dispatch(failAssistantMessage({ id: rid, error: msg, content: "I ran into an issue generating that answer." }));
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
    if (!trimmed || pendingMessageId) return;

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
        payload: { question: trimmed, debug },
        signal:  abortRef.current.signal,
      });
    } catch (err) {
      if (abortRef.current?.signal.aborted) return;
      const msg = extractErrorMessage(err);
      dispatch(setChatError(msg));
      dispatch(failAssistantMessage({ id: requestId, error: msg, content: "I ran into an issue generating that answer." }));
    }
  }, [debug, dispatch, pendingMessageId]);

  const handleSubmit = (e) => { e.preventDefault(); void submitPrompt(input); };
  const handleRetry  = () => { if (lastPromptRef.current?.question) void submitPrompt(lastPromptRef.current.question); };
  const handleQuick  = (p) => { startTransition(() => setInput(p)); textareaRef.current?.focus(); };

  const isStreaming = status === "streaming";

  return (
    <section className="workspace-page" style={{ padding: "0 1.5rem 2rem", maxWidth: 1280, margin: "0 auto" }}>

      {/* ── Page header ────────────────────────────────────────────────── */}
      <header className="ws-page-header">
        <div className="ws-page-header__copy">
          <span className="ws-eyebrow">Grounded chat</span>
          <h1>Ask your knowledge base.</h1>
          <p>Streaming answers grounded in ingested sources — markdown, code blocks, copy actions, and graceful error recovery.</p>
        </div>
        <div className="ws-page-header__actions">
          <Link to="/ingest" className="ws-btn ws-btn--ghost">Add source</Link>
          <Link to="/graph"  className="ws-btn ws-btn--primary">Open graph →</Link>
        </div>
      </header>

      {/* ── Body grid ──────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0,1fr)", gap: "1rem", alignItems: "start" }}>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="ws-metric">
            <span className="ws-metric__label">Connection</span>
            <ConnPill state={connectionState} />
          </div>
          <div className="ws-metric">
            <span className="ws-metric__label">Messages</span>
            <span className="ws-metric__value">{messages.length}</span>
          </div>

          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => dispatch(clearMessages())}
            disabled={messages.length === 0}
          >
            Clear chat
          </button>

          <label className="ws-checkbox">
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
            />
            Include debug context
          </label>

          <div style={{ marginTop: "0.5rem" }}>
            <span className="ws-eyebrow" style={{ marginBottom: "0.625rem", display: "block" }}>Quick prompts</span>
            <div className="ws-quick-prompts">
              {QUICK_PROMPTS.map((p) => (
                <button key={p} type="button" className="ws-quick-prompt" onClick={() => handleQuick(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Chat panel ───────────────────────────────────────────────── */}
        <div className="ws-panel" style={{ display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto auto", minHeight: "76vh" }}>

          <div className="ws-panel__header">
            <div>
              <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Conversation</span>
              <h2 className="ws-panel__title">Grounded answers</h2>
            </div>
            <ConnPill state={connectionState} />
          </div>

          {/* Stream */}
          <div
            className="ws-chat-stream"
            style={{ padding: "1.25rem 1.5rem" }}
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {messages.length === 0 && (
              <div className="ws-empty">
                <span className="ws-empty__icon">💬</span>
                <h3>Start with a grounded question</h3>
                <p>Ask about a source you ingested, request a summary, or probe the relationships in your graph.</p>
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

          {/* Error banner */}
          {error && (
            <div className="ws-banner ws-banner--error" style={{ margin: "0 1.5rem" }} role="alert">
              <span>{error}</span>
              <button type="button" className="ws-btn ws-btn--ghost" style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }} onClick={handleRetry}>Retry</button>
            </div>
          )}

          {/* Composer */}
          <div style={{ padding: "0 1.5rem 1.5rem" }}>
            <form onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="chatInput">Ask CortexWiki</label>
              <div className="ws-composer">
                <textarea
                  ref={textareaRef}
                  id="chatInput"
                  className="ws-composer__textarea"
                  placeholder="Ask a grounded question about your knowledge base…"
                  value={input}
                  rows={1}
                  onChange={(e) => { dispatch(clearChatError()); setInput(e.target.value); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitPrompt(input); }
                  }}
                />
                <div className="ws-composer__footer">
                  <span className="ws-composer__hint">↵ send · ⇧↵ new line</span>
                  <button
                    type="submit"
                    className="ws-btn ws-btn--primary"
                    disabled={!input.trim() || isStreaming}
                    aria-busy={isStreaming}
                  >
                    {isStreaming ? "Streaming…" : "Send →"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ChatPage;