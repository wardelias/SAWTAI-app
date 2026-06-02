"""add meetings table

Revision ID: 45e70b0b1c31
Revises: fec0fb9a8db7
Create Date: 2026-06-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "45e70b0b1c31"
down_revision: Union[str, None] = "fec0fb9a8db7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "meetings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("attendee", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("booked_by", sa.String(), nullable=False, server_default="user"),
        sa.Column("workflow_run_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workflow_run_id"], ["workflow_runs.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meetings_organization_id", "meetings", ["organization_id"])
    op.create_index("ix_meetings_start_time", "meetings", ["start_time"])
    op.create_index(op.f("ix_meetings_id"), "meetings", ["id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_meetings_id"), table_name="meetings")
    op.drop_index("ix_meetings_start_time", table_name="meetings")
    op.drop_index("ix_meetings_organization_id", table_name="meetings")
    op.drop_table("meetings")
