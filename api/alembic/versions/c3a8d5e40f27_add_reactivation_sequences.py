"""add reactivation sequences, steps and enrollments

Revision ID: c3a8d5e40f27
Revises: b2f9a4c7e1d3
Create Date: 2026-07-23 00:00:01.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3a8d5e40f27"
down_revision: Union[str, None] = "b2f9a4c7e1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reactivation_sequences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("draft", "active", "archived", name="sequence_status"),
            nullable=False,
            server_default=sa.text("'draft'::sequence_status"),
        ),
        sa.Column("quiet_hours_start", sa.Integer(), nullable=True),
        sa.Column("quiet_hours_end", sa.Integer(), nullable=True),
        sa.Column("default_timezone", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_reactivation_sequences_id"),
        "reactivation_sequences",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_reactivation_sequences_org_id",
        "reactivation_sequences",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_reactivation_sequences_org_status",
        "reactivation_sequences",
        ["organization_id", "status"],
        unique=False,
    )

    op.create_table(
        "sequence_steps",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sequence_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column(
            "delay_seconds", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("workflow_id", sa.Integer(), nullable=True),
        sa.Column("message_template_id", sa.Integer(), nullable=True),
        sa.Column(
            "stop_on_response",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.ForeignKeyConstraint(
            ["sequence_id"], ["reactivation_sequences.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "sequence_id", "step_order", name="uq_sequence_steps_order"
        ),
    )
    op.create_index(
        op.f("ix_sequence_steps_id"), "sequence_steps", ["id"], unique=False
    )
    op.create_index(
        "ix_sequence_steps_sequence_id",
        "sequence_steps",
        ["sequence_id"],
        unique=False,
    )

    op.create_table(
        "lead_sequence_enrollments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("sequence_id", sa.Integer(), nullable=False),
        sa.Column("lead_id", sa.Integer(), nullable=False),
        sa.Column(
            "current_step", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "state",
            sa.Enum(
                "active",
                "completed",
                "stopped",
                "converted",
                name="enrollment_state",
            ),
            nullable=False,
            server_default=sa.text("'active'::enrollment_state"),
        ),
        sa.Column("next_step_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stop_reason", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["sequence_id"], ["reactivation_sequences.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "sequence_id", "lead_id", name="uq_enrollment_sequence_lead"
        ),
    )
    op.create_index(
        op.f("ix_lead_sequence_enrollments_id"),
        "lead_sequence_enrollments",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_enrollments_org_id",
        "lead_sequence_enrollments",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_enrollments_due",
        "lead_sequence_enrollments",
        ["state", "next_step_at"],
        unique=False,
        postgresql_where=sa.text("state = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("ix_enrollments_due", table_name="lead_sequence_enrollments")
    op.drop_index("ix_enrollments_org_id", table_name="lead_sequence_enrollments")
    op.drop_index(
        op.f("ix_lead_sequence_enrollments_id"),
        table_name="lead_sequence_enrollments",
    )
    op.drop_table("lead_sequence_enrollments")

    op.drop_index("ix_sequence_steps_sequence_id", table_name="sequence_steps")
    op.drop_index(op.f("ix_sequence_steps_id"), table_name="sequence_steps")
    op.drop_table("sequence_steps")

    op.drop_index(
        "ix_reactivation_sequences_org_status",
        table_name="reactivation_sequences",
    )
    op.drop_index(
        "ix_reactivation_sequences_org_id", table_name="reactivation_sequences"
    )
    op.drop_index(
        op.f("ix_reactivation_sequences_id"), table_name="reactivation_sequences"
    )
    op.drop_table("reactivation_sequences")

    op.execute("DROP TYPE IF EXISTS enrollment_state")
    op.execute("DROP TYPE IF EXISTS sequence_status")
