"""merge reactivation sequences with pre-call-fetch-mode head

Revision ID: 748ed957b2e0
Revises: c3a8d5e40f27, f3a1c47b9e02
Create Date: 2026-08-27 00:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "748ed957b2e0"
down_revision: Union[str, None] = ("c3a8d5e40f27", "f3a1c47b9e02")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
