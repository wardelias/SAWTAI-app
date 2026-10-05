"""add leads and lead_activities tables

Revision ID: b2f9a4c7e1d3
Revises: 4ca4dbc270ce
Create Date: 2026-07-23 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2f9a4c7e1d3"
down_revision: Union[str, None] = "4ca4dbc270ce"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("phone_number", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("first_name", sa.String(), nullable=True),
        sa.Column("last_name", sa.String(), nullable=True),
        sa.Column(
            "attributes",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "status",
            sa.Enum(
                "new",
                "enrolled",
                "contacted",
                "responded",
                "qualified",
                "converted",
                "unresponsive",
                "suppressed",
                name="lead_status",
            ),
            nullable=False,
            server_default=sa.text("'new'::lead_status"),
        ),
        sa.Column("lead_score", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("external_id", sa.String(), nullable=True),
        sa.Column("dnc", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "consent_sms",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "consent_email",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("timezone", sa.String(), nullable=True),
        sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_action_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "phone_number", name="uq_leads_org_phone"
        ),
    )
    op.create_index(op.f("ix_leads_id"), "leads", ["id"], unique=False)
    op.create_index(
        "ix_leads_organization_id", "leads", ["organization_id"], unique=False
    )
    op.create_index(
        "ix_leads_org_status", "leads", ["organization_id", "status"], unique=False
    )
    op.create_index(
        "ix_leads_org_email",
        "leads",
        ["organization_id", "email"],
        unique=False,
        postgresql_where=sa.text("email IS NOT NULL"),
    )

    op.create_table(
        "lead_activities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lead_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("workflow_run_id", sa.Integer(), nullable=True),
        sa.Column(
            "payload",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workflow_run_id"], ["workflow_runs.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_lead_activities_id"), "lead_activities", ["id"], unique=False
    )
    op.create_index(
        "ix_lead_activities_lead_id", "lead_activities", ["lead_id"], unique=False
    )
    op.create_index(
        "ix_lead_activities_org_id",
        "lead_activities",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_lead_activities_created",
        "lead_activities",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_lead_activities_created"), table_name="lead_activities")
    op.drop_index(op.f("ix_lead_activities_org_id"), table_name="lead_activities")
    op.drop_index(op.f("ix_lead_activities_lead_id"), table_name="lead_activities")
    op.drop_index(op.f("ix_lead_activities_id"), table_name="lead_activities")
    op.drop_table("lead_activities")

    op.drop_index("ix_leads_org_email", table_name="leads")
    op.drop_index("ix_leads_org_status", table_name="leads")
    op.drop_index("ix_leads_organization_id", table_name="leads")
    op.drop_index(op.f("ix_leads_id"), table_name="leads")
    op.drop_table("leads")
    op.execute("DROP TYPE IF EXISTS lead_status")
