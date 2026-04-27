# CortexWiki 🧠

> An AI workspace where knowledge compounds — ingest sources, build a graph, ask grounded questions.

**Live →** [cortexwiki.vercel.app](https://cortexwiki.vercel.app)

---

## The Problem It Solves

Every AI chatbot has the same flaw: it forgets. Ask it something today, and tomorrow it has no memory of what you told it, what sources you trusted, or what conclusions you reached together.

CortexWiki is built around the opposite idea. You feed it YouTube videos and web pages. It extracts concepts, maps relationships, builds a persistent knowledge graph, and answers every future question **grounded in that specific knowledge** — with a source trail you can follow back.

---

## What It Does

**Ingest** — Paste a YouTube URL or web page. An 5-agent pipeline extracts facts, summarizes content, identifies concepts, maps relationships between them, checks for contradictions with existing knowledge, and stores everything in a versioned wiki. One URL becomes structured, queryable memory.

**Chat** — Ask questions against your knowledge base. Answers stream word-by-word in real time, grounded in ingested sources. Every response includes a confidence score, grounding status, and clickable source attribution. Markdown, code blocks, and copy buttons included.

**Graph** — Explore your knowledge visually. A force-directed graph renders every concept as a node and every relationship as an edge. Click a node to inspect its connections, zoom into a topic cluster, pan across the full graph. The layout stays stable — no jumps, no flicker.

---

## Architecture

### Two Pipelines, 11 Agents

```
INGEST                              QUERY
──────                              ─────
URL                                 Question
 ↓                                   ↓
Transcript / Scrape             Planner Agent
 ↓                              (wiki / web / hybrid?)
Ingestion Agent                      ↓
 ↓                         ┌─ Retrieval Agent
Summarizer Agent            └─ Web Search Agent
 ↓                                   ↓
Concept Extractor               Answer Agent
 ↓                                   ↓
Relationship Agent          Hallucination Guard
 ↓                                   ↓
Conflict Detector           Confidence Score + Sources
 ↓
Wiki Builder → MongoDB
```

Each agent has one responsibility. Each is independently testable. When something fails, it's immediately obvious where and why — not buried in a 2000-token prompt.

### Frontend

| Concern | Approach |
|---|---|
| State | Redux Toolkit — 4 slices (auth, chat, graph, ingest), clean async thunks |
| Streaming | Socket.io with automatic HTTP fallback — users never see a broken experience |
| Graph | `react-force-graph-2d` with stable position persistence via `useRef` |
| Markdown | Full GFM + syntax highlighting, memoized renderer — zero flicker during streaming |
| Auth | JWT access tokens + HttpOnly refresh cookies, silent refresh via Axios interceptor |
| Routing | React Router v6, lazy-loaded pages, protected routes with hydration guard |

### Backend

**FastAPI** — async Python, structured around route modules for auth, query, ingest, and graph.

**LangGraph** — agent orchestration. Each node in the graph is an agent; edges are conditional transitions based on planner output.

**MongoDB** — wiki pages with full version history. Every update is non-destructive.

**Neo4j** — concept graph. MongoDB stores documents; Neo4j stores relationships. Each database does what it's designed for.

---

## Engineering Problems Worth Talking About

**Duplicate message bubbles during streaming**

The assistant placeholder was being created in two places — once optimistically on submit, once when the socket fired `onStart`. The fix was removing the optimistic dispatch entirely and making the session callback the single source of truth for creating the bubble. One line removed, zero duplicates.

**Graph layout instability**

Node position cache was in `useState`. Every time positions were saved, `normalizedData` recomputed (because `positionCache` was a dependency), which re-ran the force simulation, which saved new positions — an infinite update loop. Moving the cache to `useRef` broke the cycle. State never changed, renders never triggered, layout stayed stable.

**Concurrent 401 refresh race condition**

Ten requests expiring simultaneously each triggered their own `/refresh` call. A shared `refreshPromise` reference ensures all concurrent retries await the same single in-flight refresh, then replay with the new token. Ten network calls collapsed to one.

**Streaming flicker from React re-renders**

`ReactMarkdown`'s `components` prop was a new object on every render, forcing a full remount of the renderer on every token. During a 500-token stream that was 500 unnecessary remounts. Wrapping `components` in `useMemo(() => ..., [])` reduced that to zero.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Redux Toolkit, Bootstrap 5 |
| Realtime | Socket.io |
| Backend | FastAPI, Python 3.11 |
| AI Orchestration | LangGraph, Google Gemini |
| Document Store | MongoDB Atlas |
| Graph Store | Neo4j |
| Auth | JWT + HttpOnly refresh cookies |
| Deployment | Vercel (frontend) |

---

## Project Structure

```
cortexwiki/
├── client/
│   └── src/
│       ├── pages/           # ChatPage, GraphPage, IngestPage, LandingPage
│       ├── components/      # MessageBubble, GraphViewer, MarkdownContent, Navbar
│       ├── layouts/         # AppShell
│       ├── redux/slices/    # auth · chat · graph · ingest
│       ├── services/        # http.js (Axios + interceptors) · chatStream.js
│       └── utils/           # api.js · sliceUtils.js
└── server/
    ├── app/
    │   ├── routes/          # auth · query · ingest · graph
    │   └── services/        # socketio · cache · rate limiting
    └── modules/agents/      # 11 LangGraph agents + orchestrator
```

---

## Also Built

**Finance Tracker** — A production-grade personal finance platform with a 3-server architecture (Node.js REST + GraphQL analytics + Python RAG), Google OAuth, automated monthly PDF reports, AI-powered document vault with PII masking, and Google Calendar sync.

→ [financetracker.space](https://financetracker.space) · [Repository](https://github.com/SNEHANSHU-CODE/finance-tracker)

---

*Built by [Snehanshu Sekhar Jena](https://linkedin.com/in/snehanshu-sekhar-jena) · [snehanshusekhar99@gmail.com](mailto:snehanshusekhar99@gmail.com)*