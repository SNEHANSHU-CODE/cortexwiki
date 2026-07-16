import asyncio
import os
import sys
from pathlib import Path

_SERVER_DIR = str(Path(__file__).resolve().parent)
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

from app.core.config import settings
from app.db.mongo import get_mongo_manager
import secrets

async def main():
    manager = get_mongo_manager()
    await manager.connect()

    if manager.database is not None:
        wikis_cursor = manager.database.wikis.find({})
        wikis = await wikis_cursor.to_list(length=None)
        count = 0
        for wiki in wikis:
            slug = wiki.get("slug")
            # If the slug is longer than 8 characters (old format `title-slug-uuid`)
            if slug and len(slug) > 8:
                new_slug = secrets.token_urlsafe(8).replace("_", "").replace("-", "")[:8].lower()
                await manager.database.wikis.update_one(
                    {"_id": wiki["_id"]},
                    {"$set": {"slug": new_slug}}
                )
                print(f"Updated wiki '{wiki.get('name')}' slug from {slug} to {new_slug}")
                count += 1
        print(f"Migration complete. Updated {count} wikis.")
    else:
        print("Running in memory mode. Migrating memory state (though it will clear on restart).")
        count = 0
        for wiki in manager._memory["wikis"].values():
            slug = wiki.get("slug")
            if slug and len(slug) > 8:
                new_slug = secrets.token_urlsafe(8).replace("_", "").replace("-", "")[:8].lower()
                wiki["slug"] = new_slug
                print(f"Updated memory wiki '{wiki.get('name')}' slug from {slug} to {new_slug}")
                count += 1
        print(f"Migration complete. Updated {count} wikis in memory.")

    await manager.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
