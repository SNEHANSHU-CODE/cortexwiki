import asyncio
from collections import defaultdict
from datetime import UTC, datetime

from neo4j import AsyncGraphDatabase
from neo4j.exceptions import DriverError, ServiceUnavailable, SessionExpired

from app.core.config import settings
from app.utils.logging import get_logger


logger = get_logger("app.db.graph")

# Connectivity errors that indicate AuraDB has paused/restarted.
# Only these errors should trigger a reconnect attempt.
_RECONNECTABLE_ERRORS = (ServiceUnavailable, SessionExpired, DriverError)

_RECONNECT_ATTEMPTS = 3      # max reconnect tries per failed operation
_RECONNECT_BASE_DELAY = 1.0  # seconds — doubles each attempt (1s → 2s → 4s)
_HEALTH_CHECK_INTERVAL = 300 # seconds (5 minutes) for background connectivity probe


class GraphManager:
    def __init__(self) -> None:
        self.driver = None
        self.mode = "memory"
        # Lock held for the ENTIRE duration of a reconnect attempt.
        # Concurrent callers simply wait at `async with self._lock` and then
        # see `mode == "neo4j"` on entry — no _reconnecting flag needed.
        self._lock = asyncio.Lock()
        # In-memory: keyed by (user_id, wiki_id)
        self._nodes: dict[tuple, dict[str, dict]] = defaultdict(dict)
        self._edges: list[dict] = []

    # ── Lifecycle ─────────────────────────────────────────────────────────────

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
            if self.driver is not None:
                await self.driver.close()
            self.driver = None
            self.mode = "memory"
            logger.exception("Neo4j unavailable, using in-memory graph store")

    async def disconnect(self) -> None:
        if self.driver is not None:
            await self.driver.close()
        self.driver = None

    # ── Reconnect ─────────────────────────────────────────────────────────────

    async def _reconnect(self) -> bool:
        """
        Rebuild the Neo4j driver connection with exponential backoff.
        Returns True if reconnection succeeded, False otherwise.

        The lock is held for the ENTIRE reconnect attempt (including sleeps).
        This means concurrent callers simply wait at the lock boundary.
        When the first caller finishes, subsequent callers enter the lock,
        see `mode == "neo4j"`, and return True immediately — no duplicate
        reconnect attempts and no premature False returns.
        """
        async with self._lock:
            # Another coroutine already reconnected while we waited for the lock
            if self.mode == "neo4j" and self.driver is not None:
                return True

            # Close the dead driver cleanly before creating a fresh one
            if self.driver is not None:
                try:
                    await self.driver.close()
                except Exception:
                    pass
                self.driver = None
                self.mode = "memory"

            delay = _RECONNECT_BASE_DELAY
            for attempt in range(1, _RECONNECT_ATTEMPTS + 1):
                try:
                    logger.info("Neo4j reconnect attempt %d/%d...", attempt, _RECONNECT_ATTEMPTS)
                    driver = AsyncGraphDatabase.driver(
                        settings.NEO4J_URI,
                        auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
                    )
                    await driver.verify_connectivity()
                    self.driver = driver
                    self.mode = "neo4j"
                    logger.info("Neo4j reconnected successfully on attempt %d", attempt)
                    return True
                except Exception as exc:
                    logger.warning("Neo4j reconnect attempt %d failed: %s", attempt, exc)
                    if attempt < _RECONNECT_ATTEMPTS:
                        await asyncio.sleep(delay)
                        delay *= 2  # Exponential backoff: 1s → 2s → 4s

            logger.error(
                "Neo4j reconnect failed after %d attempts. Falling back to in-memory mode.",
                _RECONNECT_ATTEMPTS,
            )
            return False

    async def _get_active_driver(self):
        """
        Return the driver if healthy, or attempt an on-demand reconnect first.

        This fixes the case where the server started while AuraDB was paused
        (driver is None, mode is "memory"). Without this, the `if self.driver
        is not None` guard in each method would silently skip the neo4j path
        forever — only the 5-minute background task would eventually reconnect.
        With this helper, the first user request after AuraDB resumes triggers
        an immediate reconnect attempt.
        """
        if self.driver is not None:
            return self.driver
        if settings.NEO4J_URI and settings.NEO4J_USER and settings.NEO4J_PASSWORD:
            if await self._reconnect():
                return self.driver
        return None

    async def _run_with_reconnect(self, operation):
        """
        Execute an async callable that uses self.driver.
        On a connectivity error: attempt one reconnect cycle, then retry the
        operation once. Raises the original error if reconnect also fails so
        the caller can use the in-memory fallback path.
        """
        try:
            return await operation()
        except _RECONNECTABLE_ERRORS as exc:
            logger.warning("Neo4j connectivity error: %s. Attempting reconnect...", exc)
            reconnected = await self._reconnect()
            if reconnected:
                # Retry once with the fresh driver — let errors propagate naturally
                return await operation()
            raise

    # ── Upsert ────────────────────────────────────────────────────────────────

    async def upsert_page_graph(
        self,
        *,
        user_id: str,
        wiki_id: str,
        page_id: str,
        nodes: list[dict],
        relationships: list[dict],
    ) -> None:
        driver = await self._get_active_driver()
        if driver is not None:
            concept_query = """
            UNWIND $nodes AS node
            MERGE (c:Concept {user_id: $user_id, wiki_id: $wiki_id, name: node.id})
            SET c.updated_at = datetime(),
                c.page_ids    = CASE WHEN $page_id IN coalesce(c.page_ids, []) THEN coalesce(c.page_ids, []) ELSE coalesce(c.page_ids, []) + [$page_id] END,
                c.type        = node.type,
                c.description = node.description,
                c.importance  = node.importance,
                c.category    = node.category
            """
            edge_query = """
            UNWIND $relationships AS rel
            MERGE (s:Concept {user_id: $user_id, wiki_id: $wiki_id, name: rel.source})
            MERGE (t:Concept {user_id: $user_id, wiki_id: $wiki_id, name: rel.target})
            MERGE (s)-[r:RELATED_TO {user_id: $user_id, wiki_id: $wiki_id, label: rel.type}]->(t)
            SET r.page_id    = $page_id,
                r.evidence   = rel.evidence,
                r.updated_at = datetime()
            """

            async def _do():
                async with self.driver.session() as session:
                    tx = await session.begin_transaction()
                    try:
                        await tx.run(concept_query, user_id=user_id, wiki_id=wiki_id, page_id=page_id, nodes=nodes)
                        await tx.run(edge_query, user_id=user_id, wiki_id=wiki_id, page_id=page_id, relationships=relationships)
                        await tx.commit()
                    except Exception:
                        try:
                            await tx.rollback()
                        except Exception:
                            logger.debug("Transaction rollback failed or not needed")
                        raise

            try:
                await self._run_with_reconnect(_do)
                return
            except _RECONNECTABLE_ERRORS:
                logger.warning("upsert_page_graph: reconnect failed, falling back to in-memory store")
            except Exception:
                raise

        # In-memory path
        key = (user_id, wiki_id)
        for node in nodes:
            existing_page_ids = self._nodes[key].get(node["id"], {}).get("page_ids", [])
            page_ids = existing_page_ids if page_id in existing_page_ids else existing_page_ids + [page_id]
            self._nodes[key][node["id"]] = {**node, "page_ids": page_ids, "updated_at": datetime.now(UTC)}

        # Remove old edges for this page to prevent edge accumulation memory leak
        self._edges = [e for e in self._edges if not (e.get("user_id") == user_id and e.get("wiki_id") == wiki_id and e.get("page_id") == page_id)]
        for rel in relationships:
            self._edges.append({**rel, "user_id": user_id, "wiki_id": wiki_id, "page_id": page_id, "created_at": datetime.now(UTC)})

    # ── Query ─────────────────────────────────────────────────────────────────

    async def get_related_concepts(
        self,
        *,
        user_id: str,
        wiki_id: str,
        query_terms: list[str],
        limit: int = 10,
    ) -> list[dict]:
        limit = max(1, min(limit, 100))
        normalized = [t.lower() for t in query_terms if t]
        if not normalized:
            return []

        driver = await self._get_active_driver()
        if driver is not None:
            cypher = """
            MATCH (s:Concept {user_id: $user_id, wiki_id: $wiki_id})-[r:RELATED_TO]->(t:Concept {user_id: $user_id, wiki_id: $wiki_id})
            WHERE any(term IN $terms WHERE toLower(s.name) CONTAINS term OR toLower(t.name) CONTAINS term)
            RETURN s.name AS source, r.label AS relationship, t.name AS target, r.evidence AS evidence
            LIMIT $limit
            """

            async def _do():
                async with self.driver.session() as session:
                    result = await session.run(cypher, user_id=user_id, wiki_id=wiki_id, terms=normalized, limit=limit)
                    return await result.data()

            try:
                return await self._run_with_reconnect(_do)
            except _RECONNECTABLE_ERRORS:
                logger.warning("get_related_concepts: reconnect failed, falling back to in-memory store")
            except Exception:
                raise

        # In-memory path
        key = (user_id, wiki_id)
        matches = []
        for edge in self._edges:
            if edge["user_id"] != user_id or edge.get("wiki_id") != wiki_id:
                continue
            searchable = f'{edge.get("source", "")} {edge.get("target", "")}'.lower()
            if any(term in searchable for term in normalized):
                matches.append({
                    "source": edge.get("source", ""),
                    "relationship": edge.get("type", "relates_to"),
                    "target": edge.get("target", ""),
                    "evidence": edge.get("evidence", ""),
                })
                if len(matches) >= limit:
                    break
        return matches

    async def get_topic_subgraph(
        self,
        *,
        user_id: str,
        wiki_id: str,
        topic: str,
        limit: int = 50,
    ) -> dict:
        limit = max(1, min(limit, 100))
        normalized_topic = topic.strip().lower()

        driver = await self._get_active_driver()
        if driver is not None:
            cypher = """
            MATCH (n:Concept {user_id: $user_id, wiki_id: $wiki_id})-[r]->(m:Concept {user_id: $user_id, wiki_id: $wiki_id})
            WHERE $topic = ""
               OR toLower(n.name) CONTAINS $topic
               OR toLower(m.name) CONTAINS $topic
            RETURN n, r, m
            LIMIT $limit
            """

            async def _do():
                async with self.driver.session() as session:
                    result = await session.run(cypher, user_id=user_id, wiki_id=wiki_id, topic=normalized_topic, limit=limit)
                    records = await result.data()
                return self._transform_subgraph_records(records)

            try:
                return await self._run_with_reconnect(_do)
            except _RECONNECTABLE_ERRORS:
                logger.warning("get_topic_subgraph: reconnect failed, falling back to in-memory store")
            except Exception:
                raise

        # In-memory path
        key = (user_id, wiki_id)
        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        for edge in self._edges:
            if edge["user_id"] != user_id or edge.get("wiki_id") != wiki_id:
                continue
            if normalized_topic and normalized_topic not in edge.get("source", "").lower() and normalized_topic not in edge.get("target", "").lower():
                continue
            src = self._nodes[key].get(edge.get("source", ""), {"id": edge.get("source", ""), "type": "concept", "description": "", "importance": 0.5, "category": None})
            tgt = self._nodes[key].get(edge.get("target", ""), {"id": edge.get("target", ""), "type": "concept", "description": "", "importance": 0.5, "category": None})
            nodes[src["id"]] = src
            nodes[tgt["id"]] = tgt
            edges.append({"source": edge.get("source", ""), "target": edge.get("target", ""), "label": edge.get("type", "RELATED_TO")})
            if len(edges) >= limit:
                break

        if not edges and not normalized_topic:
            for node in list(self._nodes[key].values())[:min(limit, 12)]:
                nodes[node["id"]] = node

        limited_nodes = list(nodes.values())[:limit]
        return {
            "nodes": [{"id": n["id"], "type": n.get("type", "concept"), "description": n.get("description", ""), "importance": float(n.get("importance", 0.5)), "category": n.get("category")} for n in limited_nodes],
            "edges": edges[:limit],
        }

    async def delete_wiki_graph(self, *, user_id: str, wiki_id: str) -> None:
        """Delete all nodes and edges belonging to a wiki."""
        driver = await self._get_active_driver()
        if driver is not None:
            cypher = """
            MATCH (c:Concept {user_id: $user_id, wiki_id: $wiki_id})
            DETACH DELETE c
            """

            async def _do():
                async with self.driver.session() as session:
                    await session.run(cypher, user_id=user_id, wiki_id=wiki_id)

            try:
                await self._run_with_reconnect(_do)
                return
            except _RECONNECTABLE_ERRORS:
                logger.warning("delete_wiki_graph: reconnect failed, falling back to in-memory store")
            except Exception:
                raise

        key = (user_id, wiki_id)
        self._nodes.pop(key, None)
        self._edges = [e for e in self._edges if not (e["user_id"] == user_id and e.get("wiki_id") == wiki_id)]

    async def delete_page_graph(self, *, user_id: str, wiki_id: str, page_id: str) -> None:
        """Delete all relationships belonging to a page, and clean up orphaned concept nodes."""
        driver = await self._get_active_driver()
        if driver is not None:
            relationship_cypher = """
            MATCH (s:Concept {user_id: $user_id, wiki_id: $wiki_id})-[r:RELATED_TO {page_id: $page_id}]->(t:Concept {user_id: $user_id, wiki_id: $wiki_id})
            DELETE r
            """
            orphan_cypher = """
            MATCH (c:Concept {user_id: $user_id, wiki_id: $wiki_id})
            WHERE NOT (c)-[:RELATED_TO {user_id: $user_id, wiki_id: $wiki_id}]-()
            DELETE c
            """

            async def _do():
                async with self.driver.session() as session:
                    tx = await session.begin_transaction()
                    try:
                        await tx.run(relationship_cypher, user_id=user_id, wiki_id=wiki_id, page_id=page_id)
                        await tx.run(orphan_cypher, user_id=user_id, wiki_id=wiki_id)
                        await tx.commit()
                    except Exception:
                        try:
                            await tx.rollback()
                        except Exception:
                            pass
                        raise

            try:
                await self._run_with_reconnect(_do)
                return
            except _RECONNECTABLE_ERRORS:
                logger.warning("delete_page_graph: reconnect failed, falling back to in-memory store")
            except Exception:
                raise

        key = (user_id, wiki_id)
        self._edges = [e for e in self._edges if not (e["user_id"] == user_id and e.get("wiki_id") == wiki_id and e.get("page_id") == page_id)]
        active_sources = {e["source"] for e in self._edges if e["user_id"] == user_id and e.get("wiki_id") == wiki_id}
        active_targets = {e["target"] for e in self._edges if e["user_id"] == user_id and e.get("wiki_id") == wiki_id}
        active_names = active_sources.union(active_targets)
        if key in self._nodes:
            self._nodes[key] = {name: node for name, node in self._nodes[key].items() if name in active_names}

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _transform_subgraph_records(self, records: list[dict]) -> dict:
        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        for record in records:
            source = record["n"]
            target = record["m"]
            relationship = record["r"]
            source_id = source.get("name") or source.get("id", "unknown")
            target_id = target.get("name") or target.get("id", "unknown")
            nodes[source_id] = {"id": source_id, "type": source.get("type", "concept"), "description": source.get("description", ""), "importance": float(source.get("importance", 0.5)), "category": source.get("category")}
            nodes[target_id] = {"id": target_id, "type": target.get("type", "concept"), "description": target.get("description", ""), "importance": float(target.get("importance", 0.5)), "category": target.get("category")}
            # Neo4j Relationship objects expose .type (the Cypher relationship type string)
            # not .get() — using getattr handles both Relationship objects and plain dicts safely.
            if isinstance(relationship, tuple):
                rel_label = relationship[1] if len(relationship) > 1 else "RELATED_TO"
            else:
                rel_label = getattr(relationship, "type", None) or relationship.get("label", "RELATED_TO")
            edges.append({"source": source_id, "target": target_id, "label": rel_label})
        return {"nodes": list(nodes.values()), "edges": edges}

    async def delete_user_graph(self, user_id: str) -> None:
        """Delete all nodes and edges belonging to a user."""
        driver = await self._get_active_driver()
        if driver is not None:
            cypher = """
            MATCH (c:Concept {user_id: $user_id})
            DETACH DELETE c
            """

            async def _do():
                async with self.driver.session() as session:
                    await session.run(cypher, user_id=user_id)

            try:
                await self._run_with_reconnect(_do)
                return
            except _RECONNECTABLE_ERRORS:
                logger.warning("delete_user_graph: reconnect failed, falling back to in-memory store")
            except Exception:
                raise

        # memory fallback
        self._nodes = {k: v for k, v in self._nodes.items() if k[0] != user_id}
        self._edges = [e for e in self._edges if e.get("user_id") != user_id]


graph_manager = GraphManager()


async def connect_to_neo4j() -> None:
    await graph_manager.connect()


async def close_neo4j_connection() -> None:
    await graph_manager.disconnect()


def get_graph_manager() -> GraphManager:
    return graph_manager


async def neo4j_health_check_task() -> None:
    """
    Background task: proactively checks Neo4j connectivity every 5 minutes.

    Two roles:
    1. When mode == "memory" (AuraDB was paused): attempt to reconnect so the
       next real user request doesn't pay the reconnect cost.
    2. When mode == "neo4j": ping verify_connectivity to detect a newly-dead
       pool early and trigger a reconnect before any user request fails.

    Runs forever; cancel it via the FastAPI lifespan shutdown.
    """
    while True:
        await asyncio.sleep(_HEALTH_CHECK_INTERVAL)
        try:
            if graph_manager.mode == "memory" and settings.NEO4J_URI:
                logger.info("Neo4j health check: in-memory mode detected, attempting proactive reconnect...")
                await graph_manager._reconnect()
            elif graph_manager.mode == "neo4j" and graph_manager.driver is not None:
                await graph_manager.driver.verify_connectivity()
                logger.debug("Neo4j health check: connectivity OK")
        except Exception as exc:
            logger.warning("Neo4j health check ping failed: %s. Triggering reconnect...", exc)
            await graph_manager._reconnect()