from loguru import logger
from pipecat.utils.run_context import set_current_run_id

from api.services.workflow_run_billing import (
    report_completed_workflow_run_platform_usage,
)
from api.tasks.run_integrations import run_integrations_post_workflow_run


async def process_lead_call_outcome(_ctx, workflow_run_id: int) -> None:
    """Record a lead call's outcome and advance its sequence (see
    ``api.services.leads.sequence_outcome``). Also enqueued directly for calls
    that never connected, which skip ``process_workflow_completion``."""
    try:
        from api.services.leads.sequence_outcome import handle_lead_call_completion

        await handle_lead_call_completion(workflow_run_id)
    except Exception as e:
        logger.error(f"Error handling lead outcome for workflow {workflow_run_id}: {e}")


async def process_workflow_completion(
    _ctx,
    workflow_run_id: int,
):
    """Process workflow completion: run integrations and report billing.

    Recording/transcript uploads happen in the pipeline process itself
    (api/services/workflow_run_artifacts.py) before this job is enqueued,
    so this task needs no shared filesystem with the web tier.

    Args:
        _ctx: ARQ context (unused)
        workflow_run_id: The workflow run ID
    """
    run_id = str(workflow_run_id)
    set_current_run_id(run_id)

    logger.info(f"Processing workflow completion for run {workflow_run_id}")

    # Run integrations including QA analysis (after uploads are complete)
    try:
        await run_integrations_post_workflow_run(_ctx, workflow_run_id)
    except Exception as e:
        logger.error(f"Error running integrations for workflow {workflow_run_id}: {e}")

    # Notify MPS after completion. MPS owns credit accounting.
    try:
        await report_completed_workflow_run_platform_usage(workflow_run_id)
    except Exception as e:
        logger.error(
            f"Error reporting platform usage for workflow {workflow_run_id}: {e}"
        )

    # Step 5: Lead outcome. No-op unless this run called a lead (a sequence
    # step or a leads-database campaign); otherwise records the outcome on the
    # lead, stops the cadence when the lead engaged (stop-on-response) or
    # schedules the next sequence step.
    await process_lead_call_outcome(_ctx, workflow_run_id)

    logger.info(f"Completed workflow completion processing for run {workflow_run_id}")
