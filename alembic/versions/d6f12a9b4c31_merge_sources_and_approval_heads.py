"""Merge source attribution and approval timestamp migration branches.

Revision ID: d6f12a9b4c31
Revises: 1fea704243f4, c91d50e8b2a1
Create Date: 2026-11-14
"""
from typing import Sequence, Union

from alembic import op

revision: str = "d6f12a9b4c31"
down_revision: Union[str, Sequence[str], None] = ("1fea704243f4", "c91d50e8b2a1")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Merge-only revision. Both parent revisions carry independent schema changes.
    pass


def downgrade() -> None:
    # Merge-only revision; downgrade to either parent branch explicitly if required.
    pass
