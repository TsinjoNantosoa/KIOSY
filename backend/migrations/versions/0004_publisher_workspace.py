"""publisher workspace editorial review

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PostgreSQL enum additions are intentionally additive and preserve existing rows.
    op.execute("ALTER TYPE editorial_status ADD VALUE IF NOT EXISTS 'changes_requested'")
    op.execute("ALTER TYPE editorial_status ADD VALUE IF NOT EXISTS 'approved'")
    op.create_table(
        "editorial_reviews",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("edition_id", sa.String(length=36), nullable=False),
        sa.Column("reviewer_id", sa.String(length=36), nullable=False),
        sa.Column("decision", sa.String(length=30), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["edition_id"], ["editions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_editorial_reviews_edition_id", "editorial_reviews", ["edition_id"])
    op.create_index("ix_editorial_reviews_reviewer_id", "editorial_reviews", ["reviewer_id"])
    op.create_index("ix_editorial_reviews_decision", "editorial_reviews", ["decision"])


def downgrade() -> None:
    op.drop_index("ix_editorial_reviews_decision", table_name="editorial_reviews")
    op.drop_index("ix_editorial_reviews_reviewer_id", table_name="editorial_reviews")
    op.drop_index("ix_editorial_reviews_edition_id", table_name="editorial_reviews")
    op.drop_table("editorial_reviews")
    # PostgreSQL cannot safely remove enum values while rows or dependent defaults may exist.
