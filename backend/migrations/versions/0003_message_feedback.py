"""Persist reader feedback on KIA answers.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_feedback",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("rating IN (-1, 1)", name="ck_message_feedback_rating"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_message_feedback_message_user"),
    )
    op.create_index(op.f("ix_message_feedback_message_id"), "message_feedback", ["message_id"])
    op.create_index(op.f("ix_message_feedback_user_id"), "message_feedback", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_message_feedback_user_id"), table_name="message_feedback")
    op.drop_index(op.f("ix_message_feedback_message_id"), table_name="message_feedback")
    op.drop_table("message_feedback")
