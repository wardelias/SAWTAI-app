"""Liveness of the background services campaigns and sequences depend on.

The ARQ worker refreshes its health-check key every
``WorkerSettings.health_check_interval`` seconds, and the campaign orchestrator
refreshes ``ORCHESTRATOR_HEARTBEAT_KEY`` on every monitoring tick. A missing
key means the service is not running, so outbound work will not progress —
surfaced in the UI instead of leaving campaigns stuck silently.
"""

from arq.constants import default_queue_name, health_check_key_suffix
from loguru import logger

WORKER_HEALTH_KEY = default_queue_name + health_check_key_suffix
ORCHESTRATOR_HEARTBEAT_KEY = "campaign_orchestrator:heartbeat"
ORCHESTRATOR_HEARTBEAT_TTL_SECONDS = 180


async def get_background_status() -> dict[str, bool]:
    from api.services.campaign.campaign_event_publisher import (
        get_campaign_event_publisher,
    )
    from api.tasks.arq import get_arq_redis

    try:
        # Read each key through the same kind of connection that writes it:
        # ARQ's settings ignore a database index in REDIS_URL, while the
        # orchestrator connects with REDIS_URL as-is.
        arq_redis = await get_arq_redis()
        worker = bool(await arq_redis.exists(WORKER_HEALTH_KEY))
        publisher = await get_campaign_event_publisher()
        orchestrator = bool(await publisher.redis.exists(ORCHESTRATOR_HEARTBEAT_KEY))
    except Exception as e:
        logger.warning(f"Could not read background service status: {e}")
        return {"worker": False, "campaign_orchestrator": False}
    return {"worker": worker, "campaign_orchestrator": orchestrator}
