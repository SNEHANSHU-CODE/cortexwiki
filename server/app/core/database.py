from app.utils.logging import get_logger
from app.db.graph import close_neo4j_connection, connect_to_neo4j
from app.db.mongo import close_mongo_connection, connect_to_mongo


logger = get_logger("core.database")


async def initialize_datastores() -> None:
    await connect_to_mongo()
    await connect_to_neo4j()
    logger.info("Datastores initialized")


async def close_datastores() -> None:
    await close_mongo_connection()
    await close_neo4j_connection()
    logger.info("Datastores closed")