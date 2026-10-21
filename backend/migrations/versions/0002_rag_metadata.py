"""Add typed metadata required by the production RAG index.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rag_passages",
        sa.Column("source_type", sa.String(length=30), nullable=False, server_default="edition_content"),
    )
    op.add_column("rag_passages", sa.Column("publication_id", sa.String(length=36), nullable=True))
    op.add_column("rag_passages", sa.Column("edition_id", sa.String(length=36), nullable=True))
    op.add_column(
        "rag_passages", sa.Column("token_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "rag_passages",
        sa.Column(
            "metadata_json",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index(op.f("ix_rag_passages_source_type"), "rag_passages", ["source_type"])
    op.create_index(op.f("ix_rag_passages_publication_id"), "rag_passages", ["publication_id"])
    op.create_index(op.f("ix_rag_passages_edition_id"), "rag_passages", ["edition_id"])
    op.drop_constraint("uq_rag_passages_document_id", "rag_passages", type_="unique")
    op.create_unique_constraint(
        "uq_rag_passages_source_document_version_chunk_space",
        "rag_passages",
        ["source_type", "document_id", "version", "chunk_index", "embedding_space"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_rag_passages_source_document_version_chunk_space", "rag_passages", type_="unique"
    )
    op.create_unique_constraint(
        "uq_rag_passages_document_id",
        "rag_passages",
        ["document_id", "version", "chunk_index", "embedding_space"],
    )
    op.drop_index(op.f("ix_rag_passages_edition_id"), table_name="rag_passages")
    op.drop_index(op.f("ix_rag_passages_publication_id"), table_name="rag_passages")
    op.drop_index(op.f("ix_rag_passages_source_type"), table_name="rag_passages")
    op.drop_column("rag_passages", "metadata_json")
    op.drop_column("rag_passages", "token_count")
    op.drop_column("rag_passages", "edition_id")
    op.drop_column("rag_passages", "publication_id")
    op.drop_column("rag_passages", "source_type")
