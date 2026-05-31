"""Railway entrypoint — runs migrations then starts uvicorn.

Replaces the shell &&-chain in railway.json startCommand. Python handles
everything so there are no shell quoting issues, stderr is merged with
stdout, and errors are always visible in Railway Deploy Logs.
"""
import os
import subprocess
import sys


def run(cmd: list[str], step: str) -> None:
    print(f"\n== {step} ==", flush=True)
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        print(f"\n[ERROR] {step} failed with exit code {result.returncode}", flush=True)
        sys.exit(result.returncode)
    print(f"[OK] {step} done", flush=True)


# ── 1. Validate required env vars ─────────────────────────────────────────────
for var in ("DATABASE_URL", "REDIS_URL", "OSS_JWT_SECRET"):
    val = os.environ.get(var, "")
    if not val:
        print(f"[ERROR] Required env var {var!r} is missing or empty.", flush=True)
        sys.exit(1)
    # Print host only (no passwords)
    if var == "DATABASE_URL":
        from urllib.parse import urlparse
        p = urlparse(val)
        print(f"[start] DATABASE_URL host={p.hostname} port={p.port} db={p.path.lstrip('/')}", flush=True)
    elif var == "REDIS_URL":
        from urllib.parse import urlparse
        p = urlparse(val)
        print(f"[start] REDIS_URL host={p.hostname} port={p.port}", flush=True)
    else:
        print(f"[start] {var} is set", flush=True)

# ── 2. Run alembic migrations ─────────────────────────────────────────────────
run(
    ["alembic", "-c", "/app/api/alembic.ini", "upgrade", "head"],
    "alembic migrations",
)

# ── 3. Start uvicorn ──────────────────────────────────────────────────────────
port = os.environ.get("PORT", "8000")
print(f"\n== starting uvicorn on port {port} ==", flush=True)
os.execvp("uvicorn", ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", port])
