"""Railway startup preflight: verify the database is reachable before alembic.

Without this, a wrong/unresolved DATABASE_URL makes alembic's asyncpg engine
hang indefinitely on connect with no output. This does a fast TCP check with a
hard timeout and prints a clear diagnosis to the deploy logs, then exits non-zero
so the deploy fails loudly instead of hanging.
"""

import os
import socket
import sys
from urllib.parse import urlparse

url = os.environ.get("DATABASE_URL", "")
if not url:
    print("[preflight] ERROR: DATABASE_URL is not set", flush=True)
    sys.exit(1)

parsed = urlparse(url)
host = parsed.hostname
port = parsed.port or 5432
db = (parsed.path or "").lstrip("/")

# Print everything except the password so the logs are self-explanatory.
print(
    f"[preflight] DATABASE_URL -> scheme={parsed.scheme} host={host} "
    f"port={port} db={db} user={parsed.username}",
    flush=True,
)

if not host:
    print(
        "[preflight] ERROR: DATABASE_URL has no host. Railway variable "
        "references (e.g. ${{Postgres.PGHOST}}) likely did not resolve. "
        "Check the app service Variables tab.",
        flush=True,
    )
    sys.exit(1)

try:
    with socket.create_connection((host, port), timeout=10):
        print(f"[preflight] TCP connect to {host}:{port} OK", flush=True)
except Exception as exc:  # noqa: BLE001 - we want to report any failure
    print(
        f"[preflight] ERROR: cannot reach {host}:{port} within 10s: "
        f"{type(exc).__name__}: {exc}",
        flush=True,
    )
    print(
        "[preflight] Most likely the DATABASE_URL host is wrong/unreachable "
        "(typo, wrong service name, or private networking not available).",
        flush=True,
    )
    sys.exit(1)

print("[preflight] database reachable — proceeding to migrations", flush=True)
