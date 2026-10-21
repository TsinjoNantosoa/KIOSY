import re
import unicodedata
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.retrieval import PassageInput, RetrievalIndex
from app.core.config import Settings
from app.db.models import ContractDocumentVersion, Edition, EditorialStatus, Publication, RagPassage


def normalize_text(text: str) -> str:
    value = unicodedata.normalize("NFKC", text).replace("\x00", " ")
    value = re.sub(r"[\t\f\v]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r" {2,}", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def chunk_sections(
    sections: Iterable[tuple[str, str]], *, target_chars: int, overlap_chars: int
) -> list[tuple[str, str]]:
    chunks: list[tuple[str, str]] = []
    for section, raw_text in sections:
        text = normalize_text(raw_text)
        if not text:
            continue
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
        current = ""
        for paragraph in paragraphs:
            units = _split_long_paragraph(paragraph, target_chars)
            for unit in units:
                candidate = f"{current}\n\n{unit}".strip() if current else unit
                if current and len(candidate) > target_chars:
                    chunks.append((section, current))
                    prefix = current[-overlap_chars:].lstrip() if overlap_chars else ""
                    current = f"{prefix}\n\n{unit}".strip()
                else:
                    current = candidate
        if current:
            chunks.append((section, current))
    return chunks


def _split_long_paragraph(paragraph: str, target_chars: int) -> list[str]:
    if len(paragraph) <= target_chars:
        return [paragraph]
    sentences = [item.strip() for item in re.split(r"(?<=[.!?…])\s+", paragraph) if item.strip()]
    if len(sentences) <= 1:
        return [
            paragraph[offset : offset + target_chars].strip()
            for offset in range(0, len(paragraph), target_chars)
            if paragraph[offset : offset + target_chars].strip()
        ]
    result: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip()
        if current and len(candidate) > target_chars:
            result.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        result.append(current)
    return result


def catalog_passages(db: Session) -> list[PassageInput]:
    rows = db.execute(
        select(Publication, Edition)
        .join(Edition, Edition.publication_id == Publication.id)
        .where(Edition.status == EditorialStatus.published)
        .order_by(Publication.id, Edition.published_at.desc())
    ).all()
    seen: set[str] = set()
    passages: list[PassageInput] = []
    for publication, edition in rows:
        if publication.id in seen:
            continue
        seen.add(publication.id)
        text = "\n".join(
            part
            for part in (
                publication.title,
                f"Auteur : {publication.author}" if publication.author else "",
                f"Univers : {publication.universe}",
                f"Langue : {publication.language}",
                f"Édition : {edition.label}",
                publication.summary,
                "Tags : " + ", ".join(publication.tags) if publication.tags else "",
            )
            if part
        )
        passages.append(
            PassageInput(
                source_type="catalog",
                document_id=publication.id,
                publication_id=publication.id,
                edition_id=edition.id,
                version=str(edition.version),
                publisher_id=publication.publisher_id,
                page_or_section="notice-catalogue",
                visibility="public",
                language=publication.language,
                effective_at=edition.published_at,
                ai_allowed=True,
                text=text,
                metadata={
                    "universe": publication.universe,
                    "format": edition.format,
                    "title": publication.title,
                    "slug": publication.slug,
                },
            )
        )
    return passages


def contract_passages(db: Session) -> list[PassageInput]:
    passages: list[PassageInput] = []
    for document in db.scalars(select(ContractDocumentVersion)):
        for section in document.sections:
            passages.append(
                PassageInput(
                    source_type="contract",
                    document_id=document.document_id,
                    version=document.version,
                    publisher_id=None,
                    page_or_section=section["id"],
                    visibility=document.visibility,
                    language="fr",
                    effective_at=document.effective_at,
                    ai_allowed=True,
                    text=f"{document.title}\n{section['title']}\n{section['body']}",
                    metadata={"title": document.title, "section_title": section["title"]},
                )
            )
    return passages


def existing_content_passages(db: Session) -> list[PassageInput]:
    rows = list(
        db.scalars(
            select(RagPassage)
            .where(RagPassage.withdrawn_at.is_(None), RagPassage.ai_allowed.is_(True))
            .order_by(RagPassage.updated_at.desc())
        )
    )
    seen: set[tuple[str, str, int]] = set()
    passages: list[PassageInput] = []
    for row in rows:
        if row.source_type not in {"edition_content", "content"}:
            continue
        key = (row.document_id, row.version, row.chunk_index)
        if key in seen:
            continue
        seen.add(key)
        edition = db.get(Edition, row.edition_id or row.document_id)
        publication = db.get(Publication, edition.publication_id) if edition else None
        passages.append(
            PassageInput(
                source_type="edition_content",
                document_id=row.document_id,
                publication_id=row.publication_id or (publication.id if publication else None),
                edition_id=row.edition_id or (edition.id if edition else row.document_id),
                version=row.version,
                publisher_id=row.publisher_id or (publication.publisher_id if publication else None),
                page_or_section=row.page_or_section,
                visibility=row.visibility,
                language=row.language,
                effective_at=row.effective_at,
                ai_allowed=row.ai_allowed,
                text=row.text,
                metadata={
                    **row.metadata_json,
                    **({"universe": publication.universe} if publication else {}),
                    **({"title": publication.title} if publication else {}),
                },
            )
        )
    passages.reverse()
    return passages


def rebuild_all(db: Session, index: RetrievalIndex, *, include_existing_content: bool = True) -> dict[str, Any]:
    grouped = {
        "catalog": catalog_passages(db),
        "contract": contract_passages(db),
        "edition_content": existing_content_passages(db) if include_existing_content else [],
    }
    indexed = {
        source_type: index.index(db, passages, force=True) if passages else 0
        for source_type, passages in grouped.items()
    }
    return {"indexed": indexed, "total": sum(indexed.values())}


def edition_passages(
    settings: Settings,
    publication: Publication,
    edition: Edition,
    sections: list[tuple[str, str]],
) -> list[PassageInput]:
    return [
        PassageInput(
            source_type="edition_content",
            document_id=edition.id,
            publication_id=publication.id,
            edition_id=edition.id,
            version=str(edition.version),
            publisher_id=publication.publisher_id,
            page_or_section=section,
            visibility="public" if edition.permissions.get("full_text_public") else "entitled",
            language=edition.language,
            effective_at=edition.published_at,
            ai_allowed=bool(edition.permissions.get("ai_indexing")),
            text=chunk,
            metadata={
                "universe": publication.universe,
                "format": edition.format,
                "title": publication.title,
                "slug": publication.slug,
            },
        )
        for section, chunk in chunk_sections(
            sections,
            target_chars=settings.rag_chunk_target_chars,
            overlap_chars=settings.rag_chunk_overlap_chars,
        )
    ]
