"""add book_meeting in ToolCategory

Revision ID: b1c2d3e4f5a6
Revises: 45e70b0b1c31
Create Date: 2026-06-02 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
from alembic_postgresql_enum import TableReference

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "45e70b0b1c31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.sync_enum_values(
        enum_schema="public",
        enum_name="tool_category",
        new_values=[
            "http_api",
            "end_call",
            "transfer_call",
            "calculator",
            "native",
            "integration",
            "mcp",
            "book_meeting",
        ],
        affected_columns=[
            TableReference(
                table_schema="public", table_name="tools", column_name="category"
            )
        ],
        enum_values_to_rename=[],
    )


def downgrade() -> None:
    op.sync_enum_values(
        enum_schema="public",
        enum_name="tool_category",
        new_values=[
            "http_api",
            "end_call",
            "transfer_call",
            "calculator",
            "native",
            "integration",
            "mcp",
        ],
        affected_columns=[
            TableReference(
                table_schema="public", table_name="tools", column_name="category"
            )
        ],
        enum_values_to_rename=[],
    )
