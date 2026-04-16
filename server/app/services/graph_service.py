import re
from collections import Counter

from app.utils.text import build_relationships, clean_text, extract_candidate_concepts
from modules.db.graph import get_graph_manager


class GraphService:
    def __init__(self) -> None:
        self.graph = get_graph_manager()

    def build_graph_payload(self, *, title: str, summary: str, content: str) -> tuple[list[dict], list[dict]]:
        concepts = extract_candidate_concepts(f"{title}. {summary}. {content}", limit=14)
        relationships = build_relationships(concepts, content, limit=24)
        concept_nodes = self._build_concept_nodes(
            concepts=concepts,
            title=title,
            summary=summary,
            content=content,
            relationships=relationships,
        )
        return concept_nodes, relationships

    async def sync_page_graph(self, *, user_id: str, page_id: str, nodes: list[dict], edges: list[dict]) -> None:
        await self.graph.upsert_page_graph(
            user_id=user_id,
            page_id=page_id,
            nodes=nodes,
            relationships=edges,
        )

    async def get_topic_graph(self, *, user_id: str, topic: str) -> dict:
        return await self.graph.get_topic_subgraph(user_id=user_id, topic=topic, limit=50)

    async def get_related_concepts(self, *, user_id: str, query: str, limit: int = 8) -> list[dict]:
        terms = re.findall(r"[a-zA-Z0-9]{3,}", query.lower())
        return await self.graph.get_related_concepts(user_id=user_id, query_terms=terms, limit=limit)

    def _build_concept_nodes(
        self,
        *,
        concepts: list[str],
        title: str,
        summary: str,
        content: str,
        relationships: list[dict],
    ) -> list[dict]:
        normalized_content = clean_text(content)
        token_counts = Counter(re.findall(r"[a-zA-Z0-9]{3,}", normalized_content.lower()))
        relationship_counts = Counter()
        for relationship in relationships:
            relationship_counts[relationship["source"]] += 1
            relationship_counts[relationship["target"]] += 1

        concept_nodes: list[dict] = []
        for index, concept in enumerate(concepts):
            mention_score = min(token_counts.get(concept.lower(), 0) / 4, 1.0)
            relationship_score = min(relationship_counts.get(concept, 0) / 4, 1.0)
            position_score = max(0.25, 1 - (index * 0.06))
            importance = round(min(1.0, (0.45 * position_score) + (0.3 * mention_score) + (0.25 * relationship_score)), 2)

            evidence = next(
                (
                    relationship.get("evidence", "")
                    for relationship in relationships
                    if relationship["source"] == concept or relationship["target"] == concept
                ),
                summary,
            )

            description = clean_text(evidence or summary or f"{concept} is part of {title}.")[:220]
            category = "core" if importance >= 0.75 else "supporting"

            concept_nodes.append(
                {
                    "id": concept,
                    "type": "concept",
                    "description": description,
                    "importance": importance,
                    "category": category,
                }
            )

        return concept_nodes


graph_service = GraphService()


def get_graph_service() -> GraphService:
    return graph_service
