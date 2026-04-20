from collections import defaultdict
from datetime import UTC, datetime

from neo4j import AsyncGraphDatabase

from app.core.config import settings
from app.utils.logging import get_logger


logger = get_logger("modules.db.graph")


class GraphManager:
    def __init__(self) -> None:
        self.driver = None
        self.mode = "memory"
        self._nodes: dict[str, dict[str, dict]] = defaultdict(dict)
        self._edges: list[dict] = []

    async def connect(self) -> None:
        if not (settings.NEO4J_URI and settings.NEO4J_USER and settings.NEO4J_PASSWORD):
            logger.warning("Neo4j credentials not configured, using in-memory graph store")
            return

        try:
            self.driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            )
            await self.driver.verify_connectivity()
            self.mode = "neo4j"
            logger.info("Connected to Neo4j")
        except Exception:
            self.driver = None
            self.mode = "memory"
            logger.exception("Neo4j unavailable, using in-memory graph store")

    async def disconnect(self) -> None:
        if self.driver is not None:
            await self.driver.close()
        self.driver = None

    async def upsert_page_graph(self, *, user_id: str, page_id: str, nodes: list[dict], relationships: list[dict]) -> None:
        if self.driver is not None:
            concept_query = """
            UNWIND $nodes AS node
            MERGE (c:Concept {user_id: $user_id, name: node.id})
            SET c.updated_at = datetime(),
                c.page_id = $page_id,
                c.type = node.type,
                c.description = node.description,
                c.importance = node.importance,
                c.category = node.category
            """
            edge_query = """
            UNWIND $relationships AS relationship
            MERGE (source:Concept {user_id: $user_id, name: relationship.source})
            MERGE (target:Concept {user_id: $user_id, name: relationship.target})
            MERGE (source)-[rel:RELATED_TO {user_id: $user_id, label: relationship.type}]->(target)
            SET rel.page_id = $page_id,
                rel.evidence = relationship.evidence,
                rel.updated_at = datetime()
            """
            async with self.driver.session() as session:
                await session.run(concept_query, user_id=user_id, page_id=page_id, nodes=nodes)
                await session.run(edge_query, user_id=user_id, page_id=page_id, relationships=relationships)
            return

        for node in nodes:
            self._nodes[user_id][node["id"]] = {
                **node,
                "page_id": page_id,
                "updated_at": datetime.now(UTC),
            }
        for relationship in relationships:
            self._edges.append({**relationship, "user_id": user_id, "page_id": page_id, "created_at": datetime.now(UTC)})

    async def get_related_concepts(self, *, user_id: str, query_terms: list[str], limit: int = 10) -> list[dict]:
        normalized_terms = [term.lower() for term in query_terms if term]
        if not normalized_terms:
            return []

        if self.driver is not None:
            query = """
            MATCH (source:Concept {user_id: $user_id})-[rel:RELATED_TO]->(target:Concept {user_id: $user_id})
            WHERE any(term IN $terms WHERE toLower(source.name) CONTAINS term OR toLower(target.name) CONTAINS term)
            RETURN source.name AS source, rel.label AS relationship, target.name AS target, rel.evidence AS evidence
            LIMIT $limit
            """
            async with self.driver.session() as session:
                result = await session.run(query, user_id=user_id, terms=normalized_terms, limit=limit)
                return await result.data()

        matches = []
        for edge in self._edges:
            if edge["user_id"] != user_id:
                continue
            searchable = f'{edge["source"]} {edge["target"]}'.lower()
            if any(term in searchable for term in normalized_terms):
                matches.append(
                    {
                        "source": edge["source"],
                        "relationship": edge["type"],
                        "target": edge["target"],
                        "evidence": edge.get("evidence", ""),
                    }
                )
        return matches[:limit]

    async def get_topic_subgraph(self, *, user_id: str, topic: str, limit: int = 50) -> dict:
        normalized_topic = topic.strip().lower()

        if self.driver is not None:
            query = """
            MATCH (n:Concept)-[r]->(m:Concept)
            WHERE n.user_id = $user_id
              AND m.user_id = $user_id
              AND (
                $topic = ""
                OR toLower(n.name) CONTAINS $topic
                OR toLower(m.name) CONTAINS $topic
              )
            RETURN n, r, m
            LIMIT $limit
            """
            async with self.driver.session() as session:
                result = await session.run(query, user_id=user_id, topic=normalized_topic, limit=limit)
                records = await result.data()
            return self._transform_subgraph_records(records)

        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        for edge in self._edges:
            if edge["user_id"] != user_id:
                continue

            source_matches = normalized_topic in edge["source"].lower()
            target_matches = normalized_topic in edge["target"].lower()
            if normalized_topic and not (source_matches or target_matches):
                continue

            source_node = self._nodes[user_id].get(edge["source"], {"id": edge["source"], "type": "concept", "description": "", "importance": 0.5, "category": "supporting"})
            target_node = self._nodes[user_id].get(edge["target"], {"id": edge["target"], "type": "concept", "description": "", "importance": 0.5, "category": "supporting"})
            nodes[source_node["id"]] = source_node
            nodes[target_node["id"]] = target_node
            edges.append(
                {
                    "source": edge["source"],
                    "target": edge["target"],
                    "label": edge["type"],
                }
            )
            if len(edges) >= limit:
                break

        if not edges and not normalized_topic:
            for user_node in list(self._nodes[user_id].values())[: min(limit, 12)]:
                nodes[user_node["id"]] = user_node

        return {
            "nodes": [
                {
                    "id": node["id"],
                    "type": node.get("type", "concept"),
                    "description": node.get("description", ""),
                    "importance": float(node.get("importance", 0.5)),
                    "category": node.get("category"),
                }
                for node in nodes.values()
            ],
            "edges": edges,
        }

    def _transform_subgraph_records(self, records: list[dict]) -> dict:
        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        for record in records:
            source = record["n"]
            target = record["m"]
            relationship = record["r"]
            nodes[source["name"]] = {
                "id": source["name"],
                "type": source.get("type", "concept"),
                "description": source.get("description", ""),
                "importance": float(source.get("importance", 0.5)),
                "category": source.get("category"),
            }
            nodes[target["name"]] = {
                "id": target["name"],
                "type": target.get("type", "concept"),
                "description": target.get("description", ""),
                "importance": float(target.get("importance", 0.5)),
                "category": target.get("category"),
            }
            edges.append(
                {
                    "source": source["name"],
                    "target": target["name"],
                    "label": relationship[1] if isinstance(relationship, tuple) else relationship.get("label", "RELATED_TO"),
                }
            )

        return {"nodes": list(nodes.values()), "edges": edges}


graph_manager = GraphManager()


async def connect_to_neo4j() -> None:
    await graph_manager.connect()


async def close_neo4j_connection() -> None:
    await graph_manager.disconnect()


def get_graph_manager() -> GraphManager:
    return graph_manager
