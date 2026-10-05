"""Railway entrypoint — runs migrations, then the web server and the
background services that campaigns, sequences and post-call processing need.

Replaces the shell &&-chain in railway.json startCommand. Python handles
everything so there are no shell quoting issues, stderr is merged with
stdout, and errors are always visible in Railway Deploy Logs.

Processes started (mirrors scripts/start_services_docker.sh):

* ``uvicorn``               — the API + call websockets. If it exits the
                              container exits, so Railway restarts it.
* ``arq`` worker            — campaign source sync, campaign batches, the
                              reactivation-sequence cron, post-call processing,
                              webhooks, Meta lead polling.
* ``campaign_orchestrator`` — schedules campaign batches, retries and
                              completion.

The two background services are restarted (with backoff) if they crash, so a
worker failure never takes the API down. Either can be switched off with
``ENABLE_ARQ_WORKER=false`` / ``ENABLE_CAMPAIGN_ORCHESTRATOR=false`` — e.g.
when they run as their own Railway services instead.
"""

import os
import signal
import subprocess
import sys
import time


def run(cmd: list[str], step: str) -> None:
    print(f"\n== {step} ==", flush=True)
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        print(f"\n[ERROR] {step} failed with exit code {result.returncode}", flush=True)
        sys.exit(result.returncode)
    print(f"[OK] {step} done", flush=True)


def _enabled(var: str) -> bool:
    return os.environ.get(var, "true").strip().lower() not in {
        "false",
        "0",
        "no",
        "off",
    }


class Service:
    """A child process that is restarted with exponential backoff when it dies."""

    def __init__(self, name: str, cmd: list[str], critical: bool = False):
        self.name = name
        self.cmd = cmd
        self.critical = critical
        self.proc: subprocess.Popen | None = None
        self.backoff = 1.0
        self.restart_at = 0.0

    def start(self) -> None:
        print(f"[start] launching {self.name}: {' '.join(self.cmd)}", flush=True)
        self.proc = subprocess.Popen(self.cmd, stderr=subprocess.STDOUT)
        self.started_at = time.monotonic()

    def poll(self) -> int | None:
        return self.proc.poll() if self.proc else None


def supervise(services: list[Service]) -> None:
    stopping = False

    def _stop(signum, _frame):
        nonlocal stopping
        stopping = True
        print(f"[start] received signal {signum}, stopping services", flush=True)
        for svc in services:
            if svc.proc and svc.proc.poll() is None:
                svc.proc.send_signal(signal.SIGTERM)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    for svc in services:
        svc.start()

    while not stopping:
        time.sleep(1)
        now = time.monotonic()
        for svc in services:
            if svc.proc is None:
                if now >= svc.restart_at:
                    svc.start()
                continue
            code = svc.poll()
            if code is None:
                # Healthy for a minute → reset backoff.
                if now - svc.started_at > 60:
                    svc.backoff = 1.0
                continue
            if svc.critical:
                # A shutdown signal delivered to the whole process group can
                # reach the child before us — that is a normal stop.
                graceful = code in (-signal.SIGTERM, -signal.SIGINT, 0)
                level = "[start]" if graceful else "[ERROR]"
                print(f"{level} {svc.name} exited with code {code}", flush=True)
                _stop(signal.SIGTERM, None)
                _wait_all(services)
                sys.exit(0 if graceful else (code if code > 0 else 1))
            print(
                f"[WARN] {svc.name} exited with code {code}; "
                f"restarting in {svc.backoff:.0f}s",
                flush=True,
            )
            svc.proc = None
            svc.restart_at = now + svc.backoff
            svc.backoff = min(svc.backoff * 2, 60)

    _wait_all(services)
    sys.exit(0)


def _wait_all(services: list[Service]) -> None:
    deadline = time.monotonic() + 25
    for svc in services:
        if not svc.proc:
            continue
        try:
            svc.proc.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            svc.proc.kill()


def main() -> None:
    # ── 1. Validate required env vars ─────────────────────────────────────────
    for var in ("DATABASE_URL", "REDIS_URL", "OSS_JWT_SECRET"):
        val = os.environ.get(var, "")
        if not val:
            print(f"[ERROR] Required env var {var!r} is missing or empty.", flush=True)
            sys.exit(1)
        # Print host only (no passwords)
        if var == "DATABASE_URL":
            from urllib.parse import urlparse

            p = urlparse(val)
            print(
                f"[start] DATABASE_URL host={p.hostname} port={p.port} db={p.path.lstrip('/')}",
                flush=True,
            )
        elif var == "REDIS_URL":
            from urllib.parse import urlparse

            p = urlparse(val)
            print(f"[start] REDIS_URL host={p.hostname} port={p.port}", flush=True)
        else:
            print(f"[start] {var} is set", flush=True)

    # ── 2. Run alembic migrations ─────────────────────────────────────────────
    run(
        ["alembic", "-c", "/app/api/alembic.ini", "upgrade", "head"],
        "alembic migrations",
    )

    # ── 3. Start uvicorn + background services ────────────────────────────────
    port = os.environ.get("PORT", "8000")
    services = [
        Service(
            "uvicorn",
            ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", port],
            critical=True,
        )
    ]
    if _enabled("ENABLE_ARQ_WORKER"):
        services.append(
            Service(
                "arq_worker",
                [
                    sys.executable,
                    "-m",
                    "arq",
                    "api.tasks.arq.WorkerSettings",
                    "--custom-log-dict",
                    "api.tasks.arq.LOG_CONFIG",
                ],
            )
        )
    else:
        print("[start] arq worker disabled (ENABLE_ARQ_WORKER=false)", flush=True)

    if _enabled("ENABLE_CAMPAIGN_ORCHESTRATOR"):
        services.append(
            Service(
                "campaign_orchestrator",
                [sys.executable, "-m", "api.services.campaign.campaign_orchestrator"],
            )
        )
    else:
        print(
            "[start] campaign orchestrator disabled (ENABLE_CAMPAIGN_ORCHESTRATOR=false)",
            flush=True,
        )

    print(f"\n== starting services (uvicorn on port {port}) ==", flush=True)
    supervise(services)


if __name__ == "__main__":
    main()
