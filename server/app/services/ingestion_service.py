from app.services.graph_service import get_graph_service
from app.services.llm import get_llm_service
from modules.db.mongo import get_mongo_manager


class IngestionService:
    def __init__(self) -> None:
        self.mongo = get_mongo_manager()
        self.llm = get_llm_service()
        self.graph_service = get_graph_service()

    async def ingest_source(
        self,
        *,
        user_id: str,
        title: str,
        source_type: str,
        source_url: str,
        raw_content: str,
    ) -> dict:
        summary = await self.llm.summarize(raw_content)
        concept_nodes, relationships = self.graph_service.build_graph_payload(
            title=title,
            summary=summary,
            content=raw_content,
        )
        concepts = [node["id"] for node in concept_nodes]
        embedding = await self.llm.embed_text(f"{title}\n{summary}\n{raw_content[:4000]}")

        raw_record = await self.mongo.store_raw_data(
            {
                "user_id": user_id,
                "title": title,
                "source_type": source_type,
                "source_url": source_url,
                "content": raw_content,
                "summary": summary,
                "concepts": concepts,
            }
        )

        wiki_page = await self.mongo.create_wiki_page(
            {
                "user_id": user_id,
                "title": title,
                "summary": summary,
                "content": raw_content,
                "source_type": source_type,
                "source_url": source_url,
                "concepts": concepts,
                "relationships": relationships,
                "embedding": embedding,
                "raw_data_id": raw_record["id"],
            }
        )

        await self.graph_service.sync_page_graph(
            user_id=user_id,
            page_id=wiki_page["id"],
            nodes=concept_nodes,
            edges=relationships,
        )

        await self.mongo.create_agent_log(
            {
                "user_id": user_id,
                "event_type": "ingest",
                "event_name": "source_ingested",
                "details": {
                    "title": title,
                    "source_type": source_type,
                    "concept_count": len(concepts),
                    "relationship_count": len(relationships),
                },
            }
        )

        return {
            "wiki_page": wiki_page,
            "summary": summary,
            "concepts": concepts,
            "conflicts": [],
        }


ingestion_service = IngestionService()


def get_ingestion_service() -> IngestionService:
    return ingestion_service
