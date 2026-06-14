"""merge upstream billing-v2 with behaviors head

Revision ID: 4ca4dbc270ce
Revises: 384be6596b36, e3f1a2b9c7d4
Create Date: 2026-06-13 21:58:20.673502

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "4ca4dbc270ce"
down_revision: Union[str, None] = ("384be6596b36", "e3f1a2b9c7d4")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
