from __future__ import annotations


class _LazyDBClient:
    """Proxy that defers DBClient() instantiation until first attribute access.

    Replaces the previous `db_client = DBClient()` at module level, which
    opened a DB connection the moment any symbol was imported from the api.db
    package — including `api.db.models.Base` in alembic/env.py, causing
    alembic to hang before migrations even started.

    Creating _LazyDBClient() is side-effect-free; the real DBClient (and its
    connection pool) is only created on the first attribute access.
    """

    _instance: object | None = None

    def _get(self) -> object:
        if self._instance is None:
            from api.db.db_client import DBClient  # noqa: PLC0415
            object.__setattr__(self, "_instance", DBClient())
        return self._instance  # type: ignore[return-value]

    def __getattr__(self, name: str) -> object:
        return getattr(self._get(), name)

    def __repr__(self) -> str:
        return f"<_LazyDBClient wrapping {self._instance!r}>"


# db_client is a real attribute in api.db.__dict__ — no conflict with
# Python's import machinery auto-binding submodule names.
db_client = _LazyDBClient()
