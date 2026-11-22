"""Fix default approval timestamp on pending AI analyses."""
from alembic import op
import sqlalchemy as sa

revision = "4ac7c8c20e11"
down_revision = "1fea704243f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE ticket_ai_analyses SET approved_at = NULL WHERE approved_by IS NULL")
    op.alter_column("ticket_ai_analyses", "approved_at",
                     existing_type=sa.DateTime(timezone=True), server_default=None, nullable=True)


def downgrade() -> None:
    op.alter_column("ticket_ai_analyses", "approved_at",
                     existing_type=sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True)
