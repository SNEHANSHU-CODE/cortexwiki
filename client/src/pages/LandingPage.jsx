import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./styles/LandingPage.css";


/* ── Animated counter ──────────────────────────────────────────────────── */
function Counter({ target, suffix = "" }) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      let start = 0;
      const step = target / 60;
      const tick = () => {
        start = Math.min(start + step, target);
        setValue(Math.floor(start));
        if (start < target) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{value}{suffix}</span>;
}

/* ── Typing effect ─────────────────────────────────────────────────────── */
const DEMO_MESSAGES = [
  { q: "Summarize what I know about transformers.", a: "Based on your 3 ingested sources: Transformers use self-attention to weigh token relationships across the entire sequence — unlike RNNs, they process all positions in parallel. Key concepts in your graph: attention heads, positional encoding, feed-forward layers." },
  { q: "Which concepts in my graph are most central?", a: "Your knowledge graph shows 'neural networks' with 14 connections, 'gradient descent' with 11, and 'backpropagation' with 9. These form the core cluster — most of your other concepts reference them." },
  { q: "What's still missing from my knowledge base?", a: "Confidence is low (0.32) on 'reinforcement learning' — only 1 source covers it. Your graph has no edges connecting it to your 'reward modeling' node. Consider ingesting a dedicated source." },
];

function DemoChat() {
  const [msgIdx, setMsgIdx] = useState(0);
  const [phase, setPhase] = useState("typing-q"); // typing-q | typing-a | pause
  const [displayQ, setDisplayQ] = useState("");
  const [displayA, setDisplayA] = useState("");
  const qRef = useRef(0);
  const aRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const msg = DEMO_MESSAGES[msgIdx];
    setDisplayQ(""); setDisplayA(""); setPhase("typing-q");
    qRef.current = 0; aRef.current = 0;

    const typeQ = () => {
      qRef.current++;
      setDisplayQ(msg.q.slice(0, qRef.current));
      if (qRef.current < msg.q.length) {
        timerRef.current = setTimeout(typeQ, 28);
      } else {
        timerRef.current = setTimeout(() => { setPhase("typing-a"); typeA(); }, 400);
      }
    };
    const typeA = () => {
      aRef.current++;
      setDisplayA(msg.a.slice(0, aRef.current));
      if (aRef.current < msg.a.length) {
        timerRef.current = setTimeout(typeA, 12);
      } else {
        timerRef.current = setTimeout(() => {
          setPhase("pause");
          timerRef.current = setTimeout(() => {
            setMsgIdx((i) => (i + 1) % DEMO_MESSAGES.length);
          }, 3200);
        }, 600);
      }
    };
    timerRef.current = setTimeout(typeQ, 300);
    return () => clearTimeout(timerRef.current);
  }, [msgIdx]);

  return (
    <div className="demo-chat-window">
      <div className="demo-chat-bar">
        <span className="demo-dot" style={{ background: "#ff5f57" }} />
        <span className="demo-dot" style={{ background: "#febc2e" }} />
        <span className="demo-dot" style={{ background: "#28c840" }} />
        <span className="demo-title">CortexWiki — Grounded Chat</span>
      </div>
      <div className="demo-chat-body">
        <div className="demo-msg demo-msg-user">
          {displayQ}<span className={phase === "typing-q" ? "demo-cursor" : "demo-cursor hidden"}>▊</span>
        </div>
        {(phase === "typing-a" || phase === "pause") && (
          <div className="demo-msg demo-msg-ai">
            <div className="demo-ai-badge">CortexWiki · Grounded</div>
            {displayA}<span className={phase === "typing-a" ? "demo-cursor" : "demo-cursor hidden"}>▊</span>
            {phase === "pause" && (
              <div className="demo-sources-row">
                <span className="demo-src-pill">📄 Attention Is All You Need</span>
                <span className="demo-src-pill">📄 The Illustrated Transformer</span>
                <span className="demo-conf">87% confidence</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Graph preview nodes ────────────────────────────────────────────────── */
const GRAPH_NODES = [
  { id: "Neural Networks", x: 50, y: 50, r: 22, cat: "core" },
  { id: "Backprop", x: 20, y: 75, r: 16, cat: "method" },
  { id: "Transformers", x: 78, y: 68, r: 20, cat: "core" },
  { id: "Attention", x: 62, y: 30, r: 14, cat: "concept" },
  { id: "Gradient Descent", x: 30, y: 28, r: 13, cat: "method" },
  { id: "LLMs", x: 85, y: 38, r: 15, cat: "concept" },
];
const GRAPH_EDGES = [
  [0, 1], [0, 2], [0, 4], [2, 3], [2, 5], [3, 5], [1, 4],
];

function GraphPreview() {
  const [hovered, setHovered] = useState(null);
  return (
    <div className="graph-preview-wrap">
      <svg viewBox="0 0 100 100" className="graph-preview-svg" aria-hidden="true">
        <defs>
          <radialGradient id="glow-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
        </defs>
        {GRAPH_EDGES.map(([a, b], i) => {
          const na = GRAPH_NODES[a], nb = GRAPH_NODES[b];
          const active = hovered === a || hovered === b;
          return (
            <line key={i}
              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke={active ? "#5eead4" : "rgba(148,163,184,0.2)"}
              strokeWidth={active ? 0.8 : 0.4}
              style={{ transition: "all 0.2s" }}
            />
          );
        })}
        {GRAPH_NODES.map((n, i) => {
          const active = hovered === i;
          const color = n.cat === "core" ? "#38bdf8" : n.cat === "method" ? "#818cf8" : "#5eead4";
          return (
            <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}>
              {active && <circle cx={n.x} cy={n.y} r={n.r + 5} fill="url(#glow-core)" />}
              <circle cx={n.x} cy={n.y} r={n.r}
                fill={active ? color : "rgba(15,118,110,0.6)"}
                stroke={active ? color : "rgba(56,189,248,0.3)"}
                strokeWidth={active ? 0.8 : 0.4}
                style={{ transition: "all 0.25s" }}
              />
              {(active || n.r > 17) && (
                <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle"
                  fontSize={active ? 4.5 : 3.8} fill="#f8fafc" fontWeight="600"
                  style={{ pointerEvents: "none", fontFamily: "IBM Plex Mono, monospace" }}>
                  {n.id}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */
function LandingPage() {
  return (
    <main className="lp-root" id="top">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="lp-hero" aria-labelledby="hero-h1">
        <div className="lp-hero-bg">
          <div className="lp-hero-orb lp-hero-orb-a" />
          <div className="lp-hero-orb lp-hero-orb-b" />
          <div className="lp-hero-grid" />
        </div>
        <div className="lp-hero-inner">
          <div>
            <div className="lp-eyebrow">Multi-agent AI · Knowledge graph · Grounded chat</div>
            <h1 className="lp-h1" id="hero-h1">
              AI that knows<br /><em>what you taught it.</em>
            </h1>
            <p className="lp-hero-p">
              Feed CortexWiki your sources. A 5-agent query pipeline routes,
              retrieves, guards against hallucination, and streams answers — every response
              grounded in what you ingested, not what the model guessed.
            </p>
            <div className="lp-hero-actions">
              <Link to="/register" className="lp-btn lp-btn-primary lp-btn-lg">
                Launch workspace →
              </Link>
              <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-lg">
                Sign in
              </Link>
            </div>
            <div className="lp-hero-stats">
              <div className="lp-stat-item">
                <span className="lp-stat-num"><Counter target={5} /></span>
                <span className="lp-stat-label">Specialized agents</span>
              </div>
              <div className="lp-stat-item">
                <span className="lp-stat-num"><Counter target={96} suffix="%" /></span>
                <span className="lp-stat-label">Max confidence</span>
              </div>
              <div className="lp-stat-item">
                <span className="lp-stat-num"><Counter target={2} /></span>
                <span className="lp-stat-label">LLM fallbacks</span>
              </div>
            </div>
          </div>
          <div className="lp-hero-right">
            <DemoChat />
          </div>
        </div>
      </section>

      <hr className="lp-divider" />

      {/* ── Stats band ───────────────────────────────────────────────────── */}
      <div className="lp-stats-band">
        <div className="lp-stats-inner">
          {[
            { n: 5, s: "", label: "LangGraph agents" },
            { n: 15, s: "min", label: "Access token TTL" },
            { n: 5, s: "", label: "Wiki pages per query" },
            { n: 7, s: "day", label: "Refresh token lifetime" },
          ].map((s, i) => (
            <div key={i}>
              <div className="lp-stat-big-num"><Counter target={s.n} suffix={s.s} /></div>
              <div className="lp-stat-big-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <div className="lp-section" id="features">
        <div className="lp-section-label">Features</div>
        <h2 className="lp-h2">Built for <em>durable understanding</em>,<br />not disposable prompts.</h2>
        <p className="lp-section-intro">
          Every component is designed around a single principle: answers should be
          traceable, verifiable, and grounded in sources you trust.
        </p>
        <div className="lp-features-grid">
          {[
            { icon: "🧠", h: "5-Agent Query Pipeline", p: "Every query runs through Planner → Retrieval → Internet Search → Hallucination Guard → Answer Agent. Each agent has one job, independently observable." },
            { icon: "🔗", h: "Knowledge Graph", p: "Concepts become nodes. Relationships become edges. Neo4j stores the graph; MongoDB stores the wiki. Each database does what it was built for." },
            { icon: "📡", h: "Real-time Streaming", p: "Answers stream word-by-word via Socket.io. If the WebSocket fails, the system silently falls back to HTTP without the user seeing a broken experience." },
            { icon: "🛡️", h: "Hallucination Guard", p: "A dedicated agent verifies every answer against source evidence before it reaches you. Low-evidence answers are flagged, not fabricated." },
            { icon: "🎯", h: "Confidence Scoring", p: "Every response carries a confidence score (0.0–0.96) computed from wiki pages, related concepts, and internet results — formula is deterministic and transparent." },
            { icon: "🔐", h: "Secure Auth", p: "JWT access tokens (15min) + HttpOnly refresh cookies (7 days). Silent token refresh via shared in-flight promise — ten concurrent 401s trigger one /refresh." },
          ].map((f) => (
            <div key={f.h} className="lp-feature-card">
              <div className="lp-feature-icon">{f.icon}</div>
              <div className="lp-feature-h">{f.h}</div>
              <p className="lp-feature-p">{f.p}</p>
            </div>
          ))}
        </div>
      </div>

      <hr className="lp-divider" />

      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <div className="lp-section" id="pipeline">
        <div className="lp-section-label">Architecture</div>
        <h2 className="lp-h2">One pipeline.<br /><em>5 agents.</em> Zero guessing.</h2>
        <p className="lp-section-intro">
          Each agent has one job. Each is independently observable. When something fails,
          you know exactly which step and why — not buried in a monolithic prompt.
        </p>
        <div className="lp-steps" style={{ marginTop: "2.5rem" }}>
          {[
            { n: "01", name: "Planner Agent", desc: "Decides routing strategy: knowledge base, internet search, or hybrid — based on question keywords and allow_internet flag", tag: "agent" },
            { n: "02", name: "Retrieval Agent", desc: "Semantic search across your ingested wiki pages via Gemini embeddings + Neo4j concept graph traversal", tag: "agent" },
            { n: "03", name: "Internet Search Agent", desc: "DuckDuckGo fallback when knowledge base is insufficient — conditional on planner decision", tag: "conditional" },
            { n: "04", name: "Hallucination Guard", desc: "Counts evidence from wiki pages, internet results, and related concepts. Sets confidence score and is_grounded flag", tag: "agent" },
            { n: "05", name: "Answer Agent", desc: "Streams the final response via Groq (primary) → Gemini (fallback). Emits query:token events per chunk over Socket.io", tag: "llm" },
          ].map((s) => (
            <div key={s.n} className="lp-step">
              <div className="lp-step-num">{s.n}</div>
              <div>
                <div className="lp-step-name">{s.name}</div>
                <div className="lp-step-desc">{s.desc}</div>
              </div>
              <span className="lp-step-tag" data-t={s.tag}>{s.tag}</span>
            </div>
          ))}
        </div>
      </div>

      <hr className="lp-divider" />

      {/* ── Graph preview ─────────────────────────────────────────────────── */}
      <div className="lp-section" id="graph" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4rem", alignItems: "center" }}>
        <div>
          <div className="lp-section-label">Knowledge graph</div>
          <h2 className="lp-h2">Concepts you can<br /><em>see and navigate.</em></h2>
          <p className="lp-section-intro" style={{ marginBottom: "1.5rem" }}>
            Every ingested source adds nodes and edges to a force-directed graph.
            Hover to highlight relationships. Click to inspect. Pan and zoom across
            your full knowledge structure.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {["Stable layout — no flicker or position jumps", "Highlight connected nodes on hover", "Click any node to inspect relationships and importance score", "Search to focus the graph on a specific topic"].map((t) => (
              <div key={t} style={{ display: "flex", gap: "0.6rem", fontSize: "0.875rem", color: "var(--text-dim)" }}>
                <span style={{ color: "var(--accent-2)", flexShrink: 0 }}>✓</span>{t}
              </div>
            ))}
          </div>
        </div>
        <GraphPreview />
      </div>

      <hr className="lp-divider" />

      {/* ── Confidence ───────────────────────────────────────────────────── */}
      <div className="lp-section" id="confidence">
        <div className="lp-section-label">Transparency</div>
        <h2 className="lp-h2">Every answer scored.<br /><em>Every source cited.</em></h2>
        <p className="lp-section-intro">
          Confidence is computed deterministically from evidence — not vibes.
          The formula is: <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--accent)", background: "rgba(56,189,248,0.08)", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>min(0.96, 0.4 + 0.1×wiki_pages + 0.03×related_concepts)</code>
        </p>
        <div className="lp-conf-grid">
          <div className="lp-conf-card">
            <div className="lp-conf-label">High confidence · Grounded</div>
            <div className="lp-conf-q">"How does attention work in transformers?"</div>
            <div className="lp-conf-score high">87%</div>
            <div className="lp-conf-sublabel">strategy: knowledge_base · is_grounded: true · 3 wiki pages</div>
            <div className="lp-conf-bar"><div className="lp-conf-fill" style={{ width: "87%", background: "var(--accent-2)" }} /></div>
          </div>
          <div className="lp-conf-card">
            <div className="lp-conf-label">Low confidence · Needs more sources</div>
            <div className="lp-conf-q">"What's the latest on reinforcement learning from human feedback?"</div>
            <div className="lp-conf-score med">32%</div>
            <div className="lp-conf-sublabel">strategy: internet_search · is_grounded: false · 0 wiki pages</div>
            <div className="lp-conf-bar"><div className="lp-conf-fill" style={{ width: "32%", background: "var(--amber)" }} /></div>
          </div>
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <div className="lp-cta-section">
        <div className="lp-cta-orb" />
        <div className="lp-cta-inner">
          <div className="lp-eyebrow" style={{ justifyContent: "center", marginBottom: "1.5rem" }}>
            Free to start · No credit card
          </div>
          <h2 className="lp-cta-h">Start building knowledge<br />that actually compounds.</h2>
          <p className="lp-cta-p">
            One workspace. Ingest sources, explore the graph, ask grounded questions.
            Every session makes the next one smarter.
          </p>
          <div className="lp-cta-actions">
            <Link to="/register" className="lp-btn lp-btn-primary lp-btn-lg">Launch workspace →</Link>
            <Link to="/login"    className="lp-btn lp-btn-ghost lp-btn-lg">Sign in</Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default LandingPage;