# 🧠 CortexWiki

> An Agentic AI Notebook that builds and maintains a self-evolving knowledge base using multi-agent systems — beyond traditional RAG.

---

## 🚀 Overview

CortexWiki is a next-generation AI notebook inspired by Karpathy’s **LLM Wiki** concept.

Unlike traditional RAG-based tools, CortexWiki performs **ingestion-time intelligence**, where agents process, refine, and store knowledge in a structured format that evolves over time.

> Learn once → Structure knowledge → Reuse forever

---

## ✨ Key Features

- 🧠 **Multi-Agent Architecture (LangGraph)**
  - Planner Agent
  - Ingestion Agent
  - Knowledge Builder Agent
  - Linker Agent
  - Validator Agent
  - Updater Agent

- 📚 **Self-Evolving Knowledge Base**
  - Automatic wiki generation
  - Versioned updates
  - Structured knowledge storage

- 🔗 **Graph-Based Intelligence**
  - Entity relationships using Neo4j
  - Concept linking and traversal

- 🔍 **Semantic Understanding (Vector Search)**
  - Similarity search
  - Deduplication
  - Context enrichment

- 🌐 **Multi-Source Ingestion**
  - YouTube transcripts
  - Web scraping
  - Documents (PDF, text)

- ⚡ **Real-Time Processing**
  - Live updates via WebSockets

- 🎛️ **User-Controlled Priority System**
  - Control trust level of sources
  - Optional internet search

---

## 🏗️ Architecture

### High-Level Flow

User Input (YouTube / Web / Docs)
↓
Planner Agent
↓
Ingestion Agent
↓
Knowledge Builder Agent
↓
Linker Agent
↓
Validator Agent
↓
Updater Agent
↓
Knowledge Base (MongoDB + Neo4j + Vector DB)


---

## 🧩 Tech Stack

### Frontend
- React (Vite)
- Redux Toolkit
- Axios
- Socket.io
- Bootstrap 5

### Backend

---

## 🧩 Tech Stack

### Frontend
- React (Vite)
- Redux Toolkit
- Axios
- Socket.io
- Bootstrap 5

### Backend
- FastAPI
- LangGraph (Agent Orchestration)
- Uvicorn

### AI / LLM
- Gemini API (Primary)
- Multi-LLM support (extensible)

### Databases
- MongoDB → Document & knowledge storage
- Neo4j → Knowledge graph (relationships)

### Ingestion
- YouTube Transcript API
- BeautifulSoup (web scraping)

---