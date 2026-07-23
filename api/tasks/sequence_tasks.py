"""ARQ tasks for the reactivation sequence engine."""

from loguru import logger


async def process_due_enrollments(_ctx) -> int:
    """Cron task: advance every reactivation-sequence enrollment whose current
    step is due. Safe to run frequently — it only claims due, active rows."""
    from api.services.leads.sequence_orchestrator import sequence_orchestrator

    processed = await sequence_orchestrator.process_due_enrollments()
    if processed:
        logger.info(f"Processed {processed} due sequence enrollment(s)")
    return processed
