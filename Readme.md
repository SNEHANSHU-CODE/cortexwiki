# CortexWiki 🧠 - Production-Ready Multi-Agent AI System

> A polished, demo-ready AI knowledge system combining persistent wikis, intelligent retrieval, and real-time responses.

## 🎯 Core Features

✅ **Multi-Agent Architecture** - 11 specialized agents for ingestion and querying  
✅ **Persistent Knowledge Wiki** - MongoDB-based knowledge as source of truth  
✅ **Intelligent Routing** - Automatic decision between wiki, web search, or hybrid  
✅ **Confidence Scoring** - Every answer includes confidence percentage  
✅ **Hallucination Guards** - Verify answers are grounded in sources  
✅ **Debug Mode** - Inspect agent decisions and intermediate outputs  
✅ **Real-Time Logging** - Track all system operations  
✅ **World-Class UI** - Modern, responsive chat and ingestion interfaces  
✅ **Rate Limiting** - Protect backend from abuse  
✅ **Caching** - Instant responses for repeated queries  

## 🚀 System Architecture

### Ingestion Pipeline
```
YouTube URL
    ↓
Extract Transcript
    ↓
[Ingestion Agent] → Extract top 10 facts
    ↓
[Summarizer Agent] → Create summary + key points
    ↓
[Concept Extractor] → Extract 5-10 concepts
    ↓
[Relationship Agent] → Build concept graph
    ↓
[Conflict Detector] → Detect contradictions
    ↓
[Wiki Builder] → Store in MongoDB with version control
    ↓
wiki_pages (Source of Truth)
```

### Query Pipeline
```
User Question
    ↓
[Planner Agent] → Decide: wiki? web? hybrid?
    ↓
    ├─→ [Retrieval Agent] ────────────┐
    └─→ [Internet Search Agent] ──────┤
                                       ↓
                         [Answer Agent] → Generate response
                                       ↓
                         [Hallucination Guard] → Verify grounding
                                       ↓
                         Response + Confidence + Sources
```

## 🎨 Frontend Features

### Chat Interface
- **Modern UI** with gradient header and smooth animations
- **Confidence Scores** displayed prominently (0-100%)
- **Source Attribution** with clickable links
- **Grounding Status** shows if answer is verified
- **Debug Mode** for inspecting agent decisions
- **Typing Animation** during response generation
- **Auto-scroll** to latest messages

### Ingest Interface
- **Real-time Progress** tracking (extracting → processing → updating)
- **Success Indicators** with visual feedback
- **Knowledge Base Display** showing all ingested items
- **Error Handling** with clear messages
- **Responsive Design** works on mobile/tablet

## 🔧 Backend Components

### Orchestrator (`modules/agents/orchestrator_v2.py`)
- Manages both pipelines (ingestion and query)
- Handles errors with fallback logic
- Calculates confidence scores
- Logs all agent operations
- Supports debug mode

### Agents (11 total)

| Agent | Purpose | Input | Output |
|-------|---------|-------|--------|
| ingestion | Extract facts | raw_content | 10 facts |
| summarizer | Create summary | content | summary + key points |
| concept_extractor | Extract concepts | content | 5-10 concepts |
| relationship | Build graph | concepts | relationships[] |
| conflict_detector | Flag contradictions | content + wiki | conflicts[] |
| wiki_builder | Persist data | all above | wiki_updated bool |
| planner | Route decision | question | strategy (wiki/web/hybrid) |
| retrieval | Query wiki | question | wiki_pages[] |
| internet_search | Fetch web | question | web_results[] |
| answer | Generate response | query + sources | answer text |
| hallucination_guard | Verify grounding | answer + sources | verified_answer |

### Services

**Socket.io** (`app/services/socketio.py`)
- Real-time client connections
- Streaming response capability (ready for implementation)
- Agent step emissions
- Progress tracking

**Caching** (`app/services/cache.py`)
- In-memory query result caching (5-minute TTL)
- Reduces redundant processing
- Automatic cleanup

**Rate Limiting** (`app/services/cache.py`)
- Per-client request limiting (20 req/min default)
- Prevents abuse
- Configurable thresholds

## 📊 API Endpoints

### Query Endpoint
```
POST /api/query
{
  "question": "What is quantum computing?",
  "debug": false
}

Response:
{
  "question": "What is quantum computing?",
  "answer": "Quantum computing is...",
  "confidence": 0.85,
  "sources": ["wiki:quantum", "web:url"],
  "is_grounded": true,
  "strategy": "hybrid",
  "debug": {...}  // Only if debug=true
}
```

### Ingest Endpoint
```
POST /api/ingest/youtube
{
  "url": "https://youtube.com/watch?v=..."
}

Response:
{
  "id": "video_id",
  "source_type": "youtube",
  "url": "...",
  "status": "ingested_and_processed"
}
```

### Health Check
```
GET /health
Response:
{
  "status": "healthy",
  "service": "CortexWiki API",
  "version": "0.2.0"
}
```

### System Stats
```
GET /stats
Response:
{
  "cache_size": 15,
  "active_clients": 3,
  "status": "operational"
}
```

## 🗄️ MongoDB Schema

### wiki_pages
```javascript
{
  _id: ObjectId,
  title: "Machine Learning",
  summary: "Brief overview...",
  content: "Detailed content...",
  concepts: ["AI", "algorithms"],
  relations: [{type: "RELATED_TO", target: "AI"}],
  sources: ["youtube:abc123"],
  version: 2,
  has_conflict: false,
  conflicts: [{source: "url", claim: "..."}],
  created_at: ISODate,
  updated_at: ISODate
}
```

### wiki_versions
```javascript
{
  wiki_id: ObjectId,  // Reference to wiki_pages
  title: "Machine Learning",
  summary: "Old summary...",
  content: "Old content...",
  version: 1,
  created_at: ISODate
}
```

### agent_logs
```javascript
{
  type: "ingest|query",
  operation: "string",
  timestamp: ISODate
}
```

## 💡 Advanced Features

### Confidence Scoring
```python
confidence = wiki_score (0.7) + web_score (0.2) + grounding_check
# Result: 0.0-1.0 scale
# >0.7 = High confidence (green)
# 0.4-0.7 = Medium confidence (yellow)
# <0.4 = Low confidence (red)
```

### Hallucination Guard
- Checks word overlap between answer and sources (40%+ threshold)
- If ungrounded, returns: "I don't have enough verified information"
- Prevents false claims even if LLM generates them

### Fallback Logic
```
Try wiki retrieval
  → If empty: fallback to web search
  → If both empty: return "Insufficient information"
```



## 🎓 Code Style

- **Language:** Python (backend), React (frontend)
- **Architecture:** Clean, minimal, no over-engineering
- **Logging:** Structured logs with timing info
- **Error Handling:** Graceful degradation
- **Type Safety:** TypedDict for all agent inputs/outputs
- **Async:** Full async/await support

## 🚢 Deployment Considerations

For production:
1. Switch to production credentials (MongoDB Atlas, etc.)
2. Enable HTTPS
3. Configure CORS properly (don't use `*`)
4. Use environment variables for secrets
5. Add authentication/authorization
6. Enable rate limiting per user
7. Setup monitoring and alerts
8. Use CDN for static assets
9. Implement caching headers
10. Add user analytics

## 📦 Dependencies

**Backend:**
- FastAPI - Web framework
- Motor - Async MongoDB driver
- LangGraph - Agent orchestration
- Gemini API - LLM
- Neo4j - Knowledge graph

**Frontend:**
- React 19 - UI framework
- Vite - Build tool
- Redux - State management
- Socket.io - Real-time communication
- Bootstrap - Styling
- Axios - HTTP client

## 🐛 Troubleshooting

### MongoDB not found
```bash
mongod --bindIp 127.0.0.1
```

### Port already in use
```bash
# Kill process on port 8000 (backend)
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Kill process on port 5173 (frontend)
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

### Empty responses
- Check if ingestion succeeded: `db.wiki_pages.find()`
- Check agent logs: `db.agent_logs.find()`
- Enable debug mode to see intermediate outputs

### Rate limit errors
- Increase limit in `app/services/cache.py`
- Or provide `x-client-id` header
