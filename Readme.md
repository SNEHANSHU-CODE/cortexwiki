# CortexWiki

> An AI workspace where knowledge compounds — ingest sources, build a graph, ask grounded questions.

**Live →** [cortexwiki.vercel.app](https://cortexwiki.vercel.app)

---

## The Problem It Solves

Every AI chatbot has the same flaw: it forgets. Ask it something today, and tomorrow it has no memory of what you told it, what sources you trusted, or what conclusions you reached together.

CortexWiki is built around the opposite idea. You feed it YouTube videos and web pages. It extracts concepts, maps relationships, builds a persistent knowledge graph, and answers every future question **grounded in that specific knowledge** — with a source trail you can follow back.

---

## What It Does

**Ingest** — Paste a YouTube URL or web page. The pipeline extracts facts, summarizes content, identifies concepts, maps relationships between them, and stores everything in a versioned wiki. One URL becomes structured, queryable memory.

**Chat** — Ask questions against your knowledge base. Answers stream word-by-word in real time, grounded in ingested sources. Every response includes a confidence score, grounding status, and clickable source attribution. Markdown, code blocks, and copy buttons included.

**Graph** — Explore your knowledge visually. A force-directed graph renders every concept as a node and every relationship as an edge. Click a node to inspect its connections, zoom into a topic cluster, pan across the full graph. The layout stays stable — no jumps, no flicker.

---

## Architecture

### Two Pipelines, 5 Agents

```
INGEST                              QUERY
──────                              ─────
URL                                 Question
 ↓                                   ↓
Transcript / Scrape             Planner Agent
 ↓                              (needs internet?)
LLM Summarize                        ↓
 ↓                         ┌─ Retrieval Agent ──────────┐
Concept Extraction          │  (MongoDB + Neo4j)         │
 ↓                          └─ Internet Search Agent     │
Graph Sync → Neo4j              (conditional, DuckDuckGo)│
 ↓                                   ↓                   │
Wiki Page → MongoDB         Hallucination Guard ──────────┘
                            (confidence + grounding)
                                     ↓
                               Answer Agent
                            (Groq primary → Gemini fallback)
                                     ↓
                            Streamed answer + sources
```

### The 5 Agents

| Agent | Responsibility |
|---|---|
| **Planner** | Decides if internet search is needed based on question keywords and `allow_internet` flag |
| **Retrieval** | Embeds question → semantic search in MongoDB + concept lookup in Neo4j |
| **Internet Search** | Scrapes DuckDuckGo via httpx + BeautifulSoup — only runs if planner requests it |
| **Hallucination Guard** | Counts evidence, computes confidence score, sets `is_grounded` flag |
| **Answer** | Builds prompt from all context, streams via Groq (primary) → Gemini (fallback) |

Orchestrated by **LangGraph** — typed state graph with conditional edges. The planner's output determines whether the internet search node runs. All agents share a single `AgentState` TypedDict — no message passing, no hidden state.

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

**LangGraph** — agent orchestration. Each node is an agent; edges are conditional transitions based on planner output. State is a typed `AgentState` dict with reducers — `trace` list is appended across nodes using `Annotated[list, operator.add]`.

**MongoDB** — wiki pages with full version history. Every update is non-destructive.

**Neo4j** — concept graph. MongoDB stores documents; Neo4j stores relationships. Each database does what it's designed for.

**LLM Strategy** — Groq (`llama-3.1-8b-instant`) as primary for generation and streaming. Gemini (`gemini-1.5-flash`) as fallback for generation and sole provider for embeddings (Groq has no embedding API).

**Socket.io** — real-time token streaming. Falls back to HTTP `POST /api/query` automatically if WebSocket fails. Auth validated on connect via Bearer token.

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

**PYTHONPATH across uvicorn reload workers**

`sys.path` mutations in the parent process are not inherited by uvicorn's reload subprocesses. Setting `os.environ["PYTHONPATH"]` before `uvicorn.run()` propagates to all child processes on all platforms — Windows, Linux, and Render.

**pydantic-settings JSON parse crash on Render**

`list[str]` fields in pydantic-settings v2.13+ are JSON-parsed from env vars before validators run. A comma-separated `FRONTEND_ORIGINS` string caused a `JSONDecodeError` on every deploy. The fix: declare the field as `str`, expose a `@property` that splits and strips it — validator never runs, crash eliminated.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Redux Toolkit |
| Realtime | Socket.io |
| Backend | FastAPI, Python 3.14 |
| AI Orchestration | LangGraph |
| LLM | Groq (primary) + Google Gemini (fallback + embeddings) |
| Document Store | MongoDB Atlas |
| Graph Store | Neo4j AuraDB |
| Cache / Auth | Redis (JWT token store) |
| Auth | JWT + HttpOnly refresh cookies |
| Deployment | Vercel (frontend) · Render (backend) |

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
    ├── run.py               # Entrypoint — sets PYTHONPATH, starts uvicorn
    └── app/
        ├── main.py          # FastAPI + Socket.io mount
        ├── api/routes/      # auth · query · ingest · graph
        ├── agents/          # LangGraph graph + 5 agent nodes
        ├── core/            # config · redis · security · database
        ├── db/              # mongo.py · graph.py
        ├── services/        # auth_service · graph_service · llm
        └── utils/           # errors · logging · text · web
```

*Built by [Snehanshu Sekhar Jena](https://linkedin.com/in/snehanshu-sekhar-jena) · [snehanshusekhar99@gmail.com](mailto:snehanshusekhar99@gmail.com)*