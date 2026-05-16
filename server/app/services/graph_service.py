"""
app/services/graph_service.py

Thin service layer between routes/agents and app/db/graph.py.
All operations are now scoped to (user_id, wiki_id).
"""

import re

from app.utils.logging import get_logger


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
        terms = re.findall(r"[a-zA-Z]{3,}", query.lower())
        return await self._graph.get_related_concepts(
            user_id=user_id,
            wiki_id=wiki_id,
            query_terms=terms,
            limit=limit,
        )

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

    def build_graph_payload(
        self,
        *,
        title: str,
        summary: str,
        content: str,
    ) -> tuple[list[dict], list[dict]]:
        """
        Extract concept nodes and relationships from ingested content.
        Simple capitalized-phrase extraction — sufficient for portfolio use.
        """
        raw_concepts = re.findall(
            r'\b[A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]{2,})*\b',
            content[:3000],
        )
        seen: set[str] = set()
        nodes: list[dict] = []
        for concept in raw_concepts:
            key = concept.lower()
            if key not in seen and len(nodes) < 15:
                seen.add(key)
                nodes.append({
                    "id": key,
                    "label": concept,
                    "type": "concept",
                    "description": "",
                    "importance": 0.5,
                    "category": "supporting",
                })

        title_id = title.lower()[:40]
        if not any(n["id"] == title_id for n in nodes):
            nodes.insert(0, {
                "id": title_id,
                "label": title,
                "type": "concept",
                "description": "",
                "importance": 0.8,
                "category": "primary",
            })

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