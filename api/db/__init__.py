from api.db.db_client import DBClient

# Lazy singleton — only instantiated on first access, not at import time.
#
# Previously this was `db_client = DBClient()` at module level, which meant
# importing *any* symbol from the api.db package (including `api.db.models.Base`
# in alembic/env.py) would immediately open a DB connection. On Railway this
# causes alembic to hang silently before migrations even start because the
# connection attempt blocks on the DB being ready.
#
# With __getattr__, `from api.db import db_client` still works everywhere in
# the app, but the connection is deferred until the first actual access.
_db_client: DBClient | None = None


def __getattr__(name: str) -> DBClient:
    global _db_client
    if name == "db_client":
        if _db_client is None:
            _db_client = DBClient()
        return _db_client
    raise AttributeError(f"module 'api.db' has no attribute {name!r}")

