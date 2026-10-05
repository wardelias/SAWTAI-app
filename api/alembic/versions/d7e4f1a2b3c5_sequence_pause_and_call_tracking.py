"""sequence pause status, SMS step text and enrollment call tracking

Adds what the reactivation-sequence engine needs to actually run:

* ``paused`` sequence status (pausing previously failed on the enum).
* ``sequence_steps.message_text`` — the body for SMS steps.
* ``lead_sequence_enrollments`` call tracking: the run the enrollment is
  waiting on (so the next step is timed from when the call ends), the last run,
  the last error, when the last step executed and how many times the current
  step has failed to execute (for retries).

Revision ID: d7e4f1a2b3c5
Revises: 748ed957b2e0
Create Date: 2026-10-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e4f1a2b3c5"
down_revision: Union[str, None] = "748ed957b2e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE sequence_status ADD VALUE IF NOT EXISTS 'paused' AFTER 'active';"
        )

    op.add_column("sequence_steps", sa.Column("message_text", sa.Text(), nullable=True))

    op.add_column(
        "lead_sequence_enrollments",
        sa.Column("waiting_on_run_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "lead_sequence_enrollments",
        sa.Column("last_workflow_run_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "lead_sequence_enrollments",
        sa.Column("last_error", sa.String(), nullable=True),
    )
    op.add_column(
        "lead_sequence_enrollments",
        sa.Column("last_step_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "lead_sequence_enrollments",
        sa.Column(
            "step_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.create_foreign_key(
        "fk_enrollments_waiting_on_run",
        "lead_sequence_enrollments",
        "workflow_runs",
        ["waiting_on_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_enrollments_last_run",
        "lead_sequence_enrollments",
        "workflow_runs",
        ["last_workflow_run_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_enrollments_last_run", "lead_sequence_enrollments", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_enrollments_waiting_on_run", "lead_sequence_enrollments", type_="foreignkey"
    )
    op.drop_column("lead_sequence_enrollments", "step_attempts")
    op.drop_column("lead_sequence_enrollments", "last_step_at")
    op.drop_column("lead_sequence_enrollments", "last_error")
    op.drop_column("lead_sequence_enrollments", "last_workflow_run_id")
    op.drop_column("lead_sequence_enrollments", "waiting_on_run_id")
    op.drop_column("sequence_steps", "message_text")
    # Postgres cannot drop an enum value; move paused sequences back to draft.
    op.execute(
        "UPDATE reactivation_sequences SET status = 'draft' WHERE status = 'paused'"
    )
