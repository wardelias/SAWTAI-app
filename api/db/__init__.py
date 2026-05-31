from __future__ import annotations

# Fully lazy — neither DBClient nor any of its 20 imported client modules
# are imported at package-load time. This means `from api.db.models import Base`
# (used by alembic/env.py) no longer triggers any DB connection code.
#
# `from api.db import db_client` still works everywhere in the app — Python
# calls __getattr__ when the name isn't found in the module dict, which imports
# DBClient and instantiates it on first access only.

_db_client = None


def __getattr__(name: str):  # noqa: ANN202
    global _db_client
    if name == "db_client":
        if _db_client is None:
            from api.db.db_client import DBClient  # deferred import
            _db_client = DBClient()
        return _db_client
    raise AttributeError(f"module 'api.db' has no attribute {name!r}")
