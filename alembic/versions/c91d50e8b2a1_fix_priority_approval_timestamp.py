"""Fix priority approval timestamp default.

Revision ID: c91d50e8b2a1
Revises: 87ed66dfc526
Create Date: 2026-11-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c91d50e8b2a1"
down_revision: Union[str, Sequence[str], None] = "87ed66dfc526"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "ticket_ai_analyses",
        "approved_at",
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=True,
        server_default=None,
    )
    # Earlier schema defaulted approved_at on every new analysis, even when
    # nobody approved it. Clear those false-positive timestamps.
    op.execute(
        "UPDATE ticket_ai_analyses "
        "SET approved_at = NULL WHERE approved_by IS NULL"
    )


def downgrade() -> None:
    op.alter_column(
        "ticket_ai_analyses",
        "approved_at",
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=True,
        server_default=sa.text("now()"),
    )
