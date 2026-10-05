"""ARQ worker configuration - setup logging before importing tasks"""

import ssl
from urllib.parse import urlparse

from api.constants import (
    META_LEADS_POLL_INTERVAL_SECONDS,
    REDIS_URL,
    TEXT_CHAT_INACTIVITY_SWEEP_INTERVAL_MINUTES,
)

# Setup logging - this is now idempotent and safe to call multiple times
from api.logging_config import setup_logging
from api.tasks.function_names import FunctionNames

setup_logging()

# Now import ARQ and task dependencies
from arq import create_pool, cron
from arq.connections import ArqRedis, RedisSettings

parsed_url = urlparse(REDIS_URL)

# Check if we're using TLS (rediss://)
use_ssl = parsed_url.scheme == "rediss"

# Create SSL context if using rediss://
ssl_context = None
if use_ssl:
    ssl_context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

REDIS_SETTINGS = RedisSettings(
    host=parsed_url.hostname or "localhost",
    port=parsed_url.port or 6379,
    password=parsed_url.password,
    conn_timeout=10,
    ssl=use_ssl,
    ssl_ca_certs=None if not use_ssl else None,
    ssl_certfile=None,
    ssl_keyfile=None,
    ssl_check_hostname=False if use_ssl else None,
)

from api.tasks.campaign_tasks import (
    poll_all_meta_connections,
    poll_meta_leads,
    process_campaign_batch,
    sync_campaign_source,
)
from api.tasks.knowledge_base_processing import process_knowledge_base_document
from api.tasks.run_integrations import run_integrations_post_workflow_run
from api.tasks.sequence_tasks import process_due_enrollments
from api.tasks.text_chat_inactivity import (
    complete_inactive_text_chat_session,
    sweep_inactive_text_chat_sessions,
)
from api.tasks.webhook_delivery import deliver_webhook, sweep_webhook_deliveries
from api.tasks.workflow_completion import (
    process_lead_call_outcome,
    process_workflow_completion,
)

# Sweep active Meta connections on a whole-minute cadence derived from the
# configured interval (rounded to whole minutes; arq cron granularity).
_META_POLL_STEP_MINUTES = max(1, META_LEADS_POLL_INTERVAL_SECONDS // 60)


class WorkerSettings:
    functions = [
        run_integrations_post_workflow_run,
        process_workflow_completion,
        sync_campaign_source,
        process_campaign_batch,
        process_knowledge_base_document,
        poll_meta_leads,
        process_due_enrollments,
        process_lead_call_outcome,
        deliver_webhook,
        complete_inactive_text_chat_session,
    ]
    cron_jobs = [
        cron(
            poll_all_meta_connections,
            minute=set(range(0, 60, _META_POLL_STEP_MINUTES)),
            second=0,
            run_at_startup=False,
        ),
        # Advance reactivation-sequence enrollments every minute.
        cron(
            process_due_enrollments,
            minute=set(range(0, 60)),
            second=0,
            run_at_startup=False,
        ),
        # Safety net for webhook deliveries whose ARQ job was lost (worker
        # restart / Redis flush): re-enqueue any pending delivery that is overdue.
        cron(
            sweep_webhook_deliveries,
            minute=set(range(0, 60, 5)),
            second=0,
            run_at_startup=True,
        ),
        # Text chats do not have a transport disconnect callback. Close stale
        # sessions so their transcript and completion integrations are finalized.
        cron(
            sweep_inactive_text_chat_sessions,
            minute=set(range(0, 60, TEXT_CHAT_INACTIVITY_SWEEP_INTERVAL_MINUTES)),
            second=30,
            run_at_startup=True,
        ),
    ]
    redis_settings = REDIS_SETTINGS
    max_jobs = 10
    # Refresh the worker's health-check key every minute so the API can tell
    # whether a worker is running (see services/background_status.py).
    health_check_interval = 60


LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    # --- Handlers ---
    "handlers": {
        "console": {  # everything goes to stdout
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "level": "WARNING",  # only WARNING and above
            "formatter": "simple",
        },
    },
    # --- Formatters (optional) ---
    "formatters": {
        "simple": {
            "format": "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        },
    },
    # --- Root logger ---
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
    # --- Optionally silence Arq itself explicitly ---
    "loggers": {
        "arq": {  # arq.* loggers
            "level": "WARNING",
            "handlers": ["console"],
            "propagate": False,
        },
    },
}


_redis_pool: ArqRedis | None = None


async def get_arq_redis() -> ArqRedis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = await create_pool(REDIS_SETTINGS)
    return _redis_pool


async def enqueue_job(function_name: FunctionNames, *args, **kwargs):
    redis = await get_arq_redis()
    # kwargs forwards ARQ job options (e.g. _job_id, _defer_by) used for
    # deterministic, backed-off webhook delivery retries.
    return await redis.enqueue_job(function_name, *args, **kwargs)
