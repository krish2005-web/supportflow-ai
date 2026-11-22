"""merge approval timestamp migration heads

Revision ID: 2f39064975c4
Revises: 4ac7c8c20e11, d6f12a9b4c31
Create Date: 2026-11-17 18:02:21.203612

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f39064975c4'
down_revision: Union[str, Sequence[str], None] = ('4ac7c8c20e11', 'd6f12a9b4c31')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
