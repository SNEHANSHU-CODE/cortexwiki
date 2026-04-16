import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const features = [
  {
    icon: "🔗",
    title: "Grounded AI answers",
    description:
      "Every response stays tethered to ingested source material and graph context, so the workspace stays explainable.",
  },
  {
    icon: "🕸️",
    title: "Graph-native understanding",
    description:
      "Concepts and relationships become navigable structure instead of disappearing into a one-off chat history.",
  },
  {
    icon: "⚡",
    title: "Fast source ingestion",
    description:
      "Pull in YouTube videos or web pages, summarize them, and turn them into reusable knowledge in one pass.",
  },
  {
    icon: "🔄",
    title: "Connected workflow",
    description:
      "Landing, auth, chat, ingest, and graph all share one visual language and one mental model.",
  },
];

const steps = [
  {
    number: "01",
    title: "Capture",
    description:
      "Bring in a source URL and let CortexWiki structure the raw material into summaries, concepts, and relationships.",
  },
  {
    number: "02",
    title: "Reason",
    description:
      "Ask grounded questions against your own knowledge base with streaming responses, citations, and clean formatting.",
  },
  {
    number: "03",
    title: "Navigate",
    description:
      "Open the graph to inspect connected nodes, zoom into a topic, and understand how ideas reinforce each other.",
  },
];

function LandingPage() {
  return (
    <main className="marketing-page" id="top">
      <Navbar
        variant="marketing"
        links={[
          { href: "#features", label: "Features" },
          { href: "#workflow", label: "Workflow" },
          { href: "#preview",  label: "Preview" },
        ]}
        actions={[
          { to: "/login",    label: "Sign in",     kind: "secondary" },
          { to: "/register", label: "Get started", kind: "primary" },
        ]}
      />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="hero-panel landing-hero" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <span className="eyebrow">Knowledge-native AI workspace</span>
          <h1 id="hero-heading">AI that remembers what it knows.</h1>
          <p className="hero-intro">
            CortexWiki turns raw sources into a living system of summaries,
            concepts, and graph relationships so your chat experience feels
            grounded, fast, and genuinely cumulative.
          </p>

          <div className="button-row">
            <Link className="button button-primary"   to="/register">Launch workspace</Link>
            <Link className="button button-secondary" to="/login">Sign in</Link>
          </div>

          <div className="hero-metrics" aria-label="Platform highlights">
            <article className="metric-card surface-card">
              <span>Grounded answers</span>
              <strong>Sources first</strong>
            </article>
            <article className="metric-card surface-card">
              <span>Graph explorer</span>
              <strong>Connected concepts</strong>
            </article>
            <article className="metric-card surface-card">
              <span>Ingestion pipeline</span>
              <strong>Video + web</strong>
            </article>
          </div>
        </div>

        <div className="hero-visual surface-panel" aria-hidden="true">
          <div className="hero-glow hero-glow-a" />
          <div className="hero-glow hero-glow-b" />
          <div className="hero-workspace">
            <div className="hero-workspace-sidebar">
              <strong>CortexWiki</strong>
              <span>Ingest</span>
              <span>Chat</span>
              <span>Graph</span>
            </div>
            <div className="hero-workspace-main">
              <div className="hero-chat-preview">
                <div className="demo-message demo-user">
                  Summarize the React rendering model.
                </div>
                <div className="demo-message demo-assistant">
                  React diff-checks the next tree, applies minimal DOM updates,
                  and maps repeated concepts into reusable components.
                </div>
              </div>
              <div className="hero-graph-preview">
                <span className="preview-node node-primary">React</span>
                <span className="preview-node node-secondary">Virtual DOM</span>
                <span className="preview-node node-secondary">Components</span>
                <span className="preview-node node-primary">State</span>
                <span className="preview-link link-a" />
                <span className="preview-link link-b" />
                <span className="preview-link link-c" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────── */}
      <section className="marketing-section" id="features" aria-labelledby="features-heading">
        <div className="section-heading">
          <span className="eyebrow">Features</span>
          <h2 id="features-heading">
            Built for durable understanding, not disposable prompts.
          </h2>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="feature-card surface-card">
              <span className="feature-icon" aria-hidden="true">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Workflow ───────────────────────────────────────────────────── */}
      <section className="marketing-section" id="workflow" aria-labelledby="workflow-heading">
        <div className="section-heading">
          <span className="eyebrow">Workflow</span>
          <h2 id="workflow-heading">From source capture to connected reasoning.</h2>
        </div>
        <div className="steps-grid">
          {steps.map((step) => (
            <article key={step.number} className="step-card surface-card">
              <span className="step-number" aria-hidden="true">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Preview ────────────────────────────────────────────────────── */}
      <section className="marketing-section" id="preview" aria-labelledby="preview-heading">
        <div className="section-heading">
          <span className="eyebrow">Preview</span>
          <h2 id="preview-heading">
            A single workspace for ingesting, chatting, and exploring knowledge.
          </h2>
        </div>
        <div className="preview-shell surface-panel" aria-hidden="true">
          <aside className="demo-sidebar">
            <strong>CortexWiki</strong>
            <span>Knowledge base first</span>
            <span>Streaming answers</span>
            <span>Graph connected</span>
            <span>Source-aware reasoning</span>
          </aside>
          <section className="demo-chat">
            <div className="demo-message demo-user">
              How does React use the Virtual DOM?
            </div>
            <div className="demo-message demo-assistant">
              React compares the current tree with the next tree, computes
              minimal updates, and applies only the necessary DOM mutations.
            </div>
            <div className="demo-sources">
              <span>Sources</span>
              <div>
                <em>React Architecture Notes</em>
                <em>Virtual DOM Overview</em>
              </div>
            </div>
          </section>
        </div>
      </section>

      {/* ── Security band ──────────────────────────────────────────────── */}
      <section
        className="security-band surface-panel"
        id="security"
        aria-labelledby="security-heading"
      >
        <span className="eyebrow">Security and control</span>
        <h2 id="security-heading">
          Built for authenticated, source-aware workflows.
        </h2>
        <p>
          CortexWiki keeps authenticated access, explicit source linkage, and
          graph-backed retrieval at the center of the experience so teams can
          understand where answers come from.
        </p>
        <Link className="button button-primary" to="/register">
          Create your workspace
        </Link>
      </section>

      <Footer />
    </main>
  );
}

export default LandingPage;