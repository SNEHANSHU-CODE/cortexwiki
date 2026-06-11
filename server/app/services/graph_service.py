"""
app/services/graph_service.py

Thin service layer between routes/agents and app/db/graph.py.
All operations are now scoped to (user_id, wiki_id).
"""

import re
import unicodedata

from app.utils.logging import get_logger

_QUERY_TERM_RE = re.compile(r"[a-zA-Z]{3,}")
_CAPITALIZED_PHRASE_RE = re.compile(r"\b[A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]{2,})*\b")
_HYPHENATED_TERM_RE = re.compile(r"\b[a-zA-Z]+-[a-zA-Z]+(?:-[a-zA-Z]+)*\b")
_TECHNICAL_TERM_RE = re.compile(r"\b[A-Z]{2,}(?:[A-Z][a-z]+)*\b|\b[a-z]+(?:[A-Z][a-z]+)+\b")


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize('NFKD', value)
    return normalized.encode('ascii', 'ignore').decode('ascii')


logger = get_logger("services.graph")


class GraphService:

    @property
    def _graph(self):
        from app.db.graph import get_graph_manager
        return get_graph_manager()

    async def sync_page_graph(
        self,
        *,
        user_id: str,
        wiki_id: str,
        page_id: str,
        nodes: list[dict],
        edges: list[dict],
    ) -> None:
        await self._graph.upsert_page_graph(
            user_id=user_id,
            wiki_id=wiki_id,
            page_id=page_id,
            nodes=nodes,
            relationships=edges,
        )

    async def get_related_concepts(
        self,
        *,
        user_id: str,
        wiki_id: str,
        query: str,
        limit: int = 8,
    ) -> list[dict]:
        """
        Get related concepts from graph.
        """
        terms = [t for t in (_normalize_text(term) for term in _QUERY_TERM_RE.findall(query.lower())) if t]
        
        try:
            concepts = await self._graph.get_related_concepts(
                user_id=user_id,
                wiki_id=wiki_id,
                query_terms=terms,
                limit=limit,
            )
            if concepts:
                return concepts
        except Exception as exc:
            logger.warning("Search failed for query=%s: %s", query, str(exc))
        
        logger.info("No concepts found for query=%s, returning empty result", query)
        return []

    async def get_topic_graph(
        self,
        *,
        user_id: str,
        wiki_id: str,
        topic: str = "",
    ) -> dict:
        return await self._graph.get_topic_subgraph(
            user_id=user_id,
            wiki_id=wiki_id,
            topic=topic,
            limit=50,
        )

    async def delete_wiki_graph(self, *, user_id: str, wiki_id: str) -> None:
        await self._graph.delete_wiki_graph(user_id=user_id, wiki_id=wiki_id)

    async def delete_page_graph(self, *, user_id: str, wiki_id: str, page_id: str) -> None:
        await self._graph.delete_page_graph(user_id=user_id, wiki_id=wiki_id, page_id=page_id)

    def build_graph_payload(
        self,
        *,
        title: str,
        summary: str,
        content: str,
    ) -> tuple[list[dict], list[dict]]:
        """
        Extract concept nodes and relationships from ingested content.
        
        BUG FIX #5: Improved extraction with multiple patterns and higher limits.
        """
        import hashlib
        
        # BUG FIX #5: Extract concepts using multiple patterns
        # 1. Capitalized phrases (proper nouns)
        content_force = content[:5000]
        capitalized = _CAPITALIZED_PHRASE_RE.findall(content_force)
        hyphenated = _HYPHENATED_TERM_RE.findall(content_force)
        technical = _TECHNICAL_TERM_RE.findall(content_force)
        
        # Combine and deduplicate with sanitized IDs
        def _sanitize_id(s: str, max_len: int = 64) -> str:
            s = unicodedata.normalize('NFKD', s)
            s = s.encode('ascii', 'ignore').decode('ascii')
            s = s.lower()
            s = re.sub(r'[^a-z0-9_-]', '-', s)
            s = re.sub(r'-{2,}', '-', s).strip('-')
            return s[:max_len]

        seen: set[str] = set()
        nodes: list[dict] = []

        # Add capitalized phrases first (highest priority)
        for concept in capitalized + hyphenated + technical:
            raw_key = concept
            key = _sanitize_id(raw_key, max_len=64)
            if not key:
                continue
            if key not in seen and len(nodes) < 30:  # BUG FIX #5: Increased limit from 15 to 30
                seen.add(key)
                # Determine category based on source
                category = "supporting"
                if concept in capitalized:
                    category = "entity"
                elif concept in hyphenated:
                    category = "technical_term"
                else:
                    category = "technical_term"

                nodes.append({
                    "id": key,
                    "label": concept,
                    "type": "concept",
                    "description": "",
                    "importance": 0.5,
                    "category": category,
                })

        # Use hash suffix to prevent ID collisions with similar titles
        # Use SHA256 and longer prefix to reduce collision probability
        title_hash = hashlib.sha256(title.encode()).hexdigest()[:12]
        title_slug = _sanitize_id(title, max_len=35)
        candidate_title_id = f"{title_slug}-{title_hash}"

        # Ensure title_id does not collide with other node ids; if it does,
        # append a short unique suffix (uuid4 hex fragment).
        existing_ids = {n["id"] for n in nodes}
        title_id = candidate_title_id
        if title_id in existing_ids:
            import uuid
            title_id = f"{candidate_title_id}-{uuid.uuid4().hex[:6]}"
        if not any(n["id"] == title_id for n in nodes):
            nodes.insert(0, {
                "id": title_id,
                "label": title,
                "type": "concept",
                "description": "",
                "importance": 0.8,
                "category": "primary",
            })

        # Ensure node id uniqueness: if sanitization produced duplicates,
        # append numeric suffixes to subsequent occurrences.
        seen_ids = set()
        final_nodes = []
        for n in nodes:
            nid = n["id"]
            if nid in seen_ids:
                # find a unique suffix
                i = 1
                new_id = f"{nid}-{i}"
                while new_id in seen_ids:
                    i += 1
                    new_id = f"{nid}-{i}"
                n["id"] = new_id
                # Also update label if needed (keep original label)
                nid = new_id
            seen_ids.add(nid)
            final_nodes.append(n)

        nodes = final_nodes

        edges = [
            {
                "source": title_id,
                "target": node["id"],
                "type": "contains",
                "evidence": "",
            }
            for node in nodes[1:]
        ]
        return nodes, edges


_graph_service = GraphService()


def get_graph_service() -> GraphService:
    return _graph_service