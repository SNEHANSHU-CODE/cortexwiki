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

function ChatPage() {
  const [input, setInput]   = useState("");
  const [debug, setDebug]   = useState(false);
  const dispatch            = useDispatch();
  const { accessToken }     = useSelector((s) => s.auth);
  const { messages, pendingMessageId, status, error, connectionState } = useSelector((s) => s.chat);

  const sessionRef          = useRef(null);
  const abortRef            = useRef(null);
  const lastPromptRef       = useRef(null);
  const scrollAnchorRef     = useRef(null);
  const textareaRef         = useRef(null);

  // ── Session setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    sessionRef.current = createChatStreamSession({
      token: accessToken,
      onConnectionChange: (state) => dispatch(setConnectionState(state)),
      // onStart is called by the fallback AFTER the HTTP response arrives.
      // For sockets it arrives as a server event. Either way we create the
      // assistant bubble here — NOT inside submitPrompt — to avoid duplicates.
      onStart: ({ requestId }) =>
        dispatch(startAssistantMessage({ id: requestId, createdAt: new Date().toISOString() })),
      onToken: ({ requestId, chunk }) =>
        dispatch(appendAssistantChunk({ id: requestId, chunk })),
      onComplete: ({ requestId, content, metadata }) =>
        dispatch(finishAssistantMessage({ id: requestId, content, metadata })),
      onError: (err) => {
        const msg       = extractErrorMessage(err);
        const requestId = lastPromptRef.current?.requestId;
        dispatch(setChatError(msg));
        if (requestId) {
          dispatch(failAssistantMessage({
            id:      requestId,
            error:   msg,
            content: "I ran into an issue while generating that answer.",
          }));
        }
      },
    });

    return () => {
      sessionRef.current?.disconnect();
      abortRef.current?.abort();
    };
  }, [accessToken, dispatch]);

  // ── Auto-scroll on new content ─────────────────────────────────────────
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: messages.length > 1 ? "smooth" : "auto",
      block: "end",
    });
  }, [messages, pendingMessageId]);

  // ── Auto-resize textarea ───────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // ── Submit ─────────────────────────────────────────────────────────────
  const submitPrompt = useCallback(async (question) => {
    const trimmed = question.trim();
    if (!trimmed || pendingMessageId) return;

    const requestId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    abortRef.current?.abort();
    abortRef.current  = new AbortController();
    lastPromptRef.current = { question: trimmed, debug, requestId };

    dispatch(clearChatError());
    dispatch(addUserMessage({ id: `${requestId}-user`, role: "user", content: trimmed, createdAt }));
    // NOTE: do NOT dispatch startAssistantMessage here.
    // The session's onStart callback handles it — this prevents the duplicate
    // empty bubble that was appearing before the first token arrived.
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
      dispatch(failAssistantMessage({
        id:      requestId,
        error:   msg,
        content: "I ran into an issue while generating that answer.",
      }));
    }
  }, [debug, dispatch, pendingMessageId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    void submitPrompt(input);
  };

  const handleRetry = () => {
    if (lastPromptRef.current?.question) {
      void submitPrompt(lastPromptRef.current.question);
    }
  };

  const handleQuickPrompt = (prompt) => {
    startTransition(() => setInput(prompt));
    textareaRef.current?.focus();
  };

  const isStreaming = status === "streaming";

  return (
    <section className="workspace-page">
      <header className="hero-panel page-header-panel">
        <div className="page-header-copy">
          <span className="eyebrow">Grounded chat</span>
          <h1>Ask against your knowledge base.</h1>
          <p>
            Streaming answers stay connected to ingested sources and graph
            relationships, with markdown support, copy actions, and graceful
            error recovery.
          </p>
        </div>
        <div className="page-header-actions">
          <Link className="button button-secondary" to="/ingest">Add source</Link>
          <Link className="button button-primary"   to="/graph">Open graph</Link>
        </div>
      </header>

      <div className="workspace-grid chat-grid">
        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="surface-panel chat-sidebar">
          <article className="metric-card surface-card">
            <span>Connection</span>
            <strong>
              {connectionState === "connected"    ? "Socket live"    :
               connectionState === "reconnecting" ? "Reconnecting…"  :
               "HTTP fallback"}
            </strong>
          </article>

          <article className="metric-card surface-card">
            <span>Messages</span>
            <strong>{messages.length}</strong>
          </article>

          <div className="sidebar-actions">
            <button
              type="button"
              className="button button-secondary button-block"
              onClick={() => dispatch(clearMessages())}
              disabled={messages.length === 0}
            >
              Clear chat
            </button>
            <label className="checkbox-field" htmlFor="debugMode">
              <input
                id="debugMode"
                type="checkbox"
                checked={debug}
                onChange={(e) => setDebug(e.target.checked)}
              />
              <span>Include debug context</span>
            </label>
          </div>

          <div className="quick-prompts">
            <span className="eyebrow">Quick prompts</span>
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="quick-prompt"
                onClick={() => handleQuickPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </aside>

        {/* ── Chat panel ───────────────────────────────────────────────── */}
        <section className="surface-panel chat-panel">
          <header className="section-heading-inline">
            <div>
              <span className="eyebrow">Conversation</span>
              <h2>Grounded answers with clean formatting</h2>
            </div>
            <span className={`connection-pill is-${connectionState}`} aria-label={`Connection: ${connectionState}`}>
              {connectionState}
            </span>
          </header>

          <div className="chat-stream" role="log" aria-live="polite" aria-atomic="false">
            {messages.length === 0 && (
              <div className="empty-state">
                <h3>Start with a grounded question</h3>
                <p>
                  Ask about a source you ingested, request a summary, or probe
                  the relationships inside your graph.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onRetry={message.status === "error" ? handleRetry : undefined}
              />
            ))}
            <div ref={scrollAnchorRef} aria-hidden="true" />
          </div>

          {error && (
            <div className="status-banner is-error" role="alert">
              <span>{error}</span>
              <button type="button" className="ghost-button" onClick={handleRetry}>
                Retry
              </button>
            </div>
          )}

          <form className="chat-composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="chatInput">Ask CortexWiki</label>
            <textarea
              ref={textareaRef}
              id="chatInput"
              className="text-area"
              placeholder="Ask a grounded question about your knowledge base…"
              value={input}
              rows={1}
              onChange={(e) => {
                dispatch(clearChatError());
                setInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitPrompt(input);
                }
              }}
            />
            <div className="composer-actions">
              <p className="field-hint">Enter to send · Shift + Enter for new line</p>
              <button
                type="submit"
                className="button button-primary"
                disabled={!input.trim() || isStreaming}
                aria-busy={isStreaming}
              >
                {isStreaming ? "Streaming…" : "Send"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}

export default ChatPage;