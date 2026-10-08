import re
import unicodedata
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.serializers import edition_out, money, offer_out, publication_out
from app.core.errors import DomainError
from app.db.models import Edition, EditorialStatus, Offer, Publication, Publisher


def latest_offer_rows(db: Session) -> list[Offer]:
    latest = (
        select(Offer.offer_key, func.max(Offer.version).label("version")).group_by(Offer.offer_key).subquery()
    )
    return list(
        db.scalars(
            select(Offer).join(
                latest, (Offer.offer_key == latest.c.offer_key) & (Offer.version == latest.c.version)
            )
        )
    )


def get_latest_offer(db: Session, public_id: str, lock: bool = False) -> Offer:
    statement = select(Offer).where(Offer.offer_key == public_id).order_by(Offer.version.desc()).limit(1)
    if lock:
        statement = statement.with_for_update()
    item = db.scalar(statement)
    if not item:
        raise DomainError(404, "NOT_FOUND", "Offre introuvable.")
    return item


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")[:150] or "publication"


def publication_detail(db: Session, identifier: str) -> dict[str, Any]:
    publication = db.scalar(
        select(Publication).where(or_(Publication.id == identifier, Publication.slug == identifier))
    )
    if not publication:
        raise DomainError(404, "NOT_FOUND", "Publication introuvable.")
    editions = list(
        db.scalars(
            select(Edition)
            .where(Edition.publication_id == publication.id, Edition.status == EditorialStatus.published)
            .order_by(Edition.published_at.desc())
        )
    )
    if not editions:
        raise DomainError(404, "NOT_FOUND", "Publication introuvable.")
    publisher = db.get(Publisher, publication.publisher_id)
    edition_ids = {edition.id for edition in editions}
    offers = [
        row
        for row in latest_offer_rows(db)
        if row.scope.get("publication_id") == publication.id
        or row.scope.get("edition_id") in edition_ids
        or row.scope.get("universe") == publication.universe
    ]
    return {
        "publication": publication_out(publication, publisher),
        "editions": [edition_out(row) for row in editions],
        "offers": [offer_out(row) for row in offers],
    }


def catalog(
    db: Session,
    *,
    q: str | None,
    universe: str | None,
    language: str | None,
    format: str | None,
    price: str | None,
    sort: str,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    query = (
        select(Publication, Edition, Publisher)
        .join(Edition, Edition.publication_id == Publication.id)
        .join(Publisher, Publisher.id == Publication.publisher_id)
        .where(Edition.status == EditorialStatus.published)
    )
    if q:
        query = query.where(
            or_(
                Publication.title.ilike(f"%{q}%"),
                Publication.author.ilike(f"%{q}%"),
                Publication.summary.ilike(f"%{q}%"),
            )
        )
    if universe:
        query = query.where(Publication.universe == universe)
    if language:
        query = query.where(Publication.language == language)
    if format:
        query = query.where(Edition.format == format)
    ordering = Publication.title.asc() if sort == "title" else Edition.published_at.desc()
    rows = db.execute(query.order_by(ordering, Publication.id.asc())).all()
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    offers = latest_offer_rows(db)
    for publication, edition, publisher in rows:
        if publication.id in seen:
            continue
        seen.add(publication.id)
        applicable = [
            offer
            for offer in offers
            if offer.status == "active"
            and (
                offer.scope.get("publication_id") == publication.id
                or offer.scope.get("edition_id") == edition.id
                or offer.scope.get("universe") == publication.universe
            )
        ]
        paid = [offer for offer in applicable if offer.price_amount > 0]
        has_free = edition.is_free or any(offer.kind.value == "free" for offer in applicable)
        if price == "free" and not has_free:
            continue
        if price == "paid" and not paid:
            continue
        lowest = min(paid, key=lambda offer: offer.price_amount) if paid else None
        items.append(
            {
                "publication": publication_out(publication, publisher),
                "latest_edition": edition_out(edition),
                "edition_count": 1,
                "price_from": money(lowest.price_amount, lowest.price_currency, lowest.price_scale)
                if lowest
                else None,
                "has_free_content": has_free,
                "formats": [edition.format],
            }
        )
    facets = {
        "universe": {
            key: sum(1 for item in items if item["publication"]["universe"] == key)
            for key in ("presse", "business", "culture")
        },
        "language": {
            key: sum(1 for item in items if item["publication"]["language"] == key)
            for key in ("fr", "mg", "en")
        },
        "format": {key: sum(1 for item in items if key in item["formats"]) for key in ("text", "pdf")},
    }
    total = len(items)
    start = (page - 1) * page_size
    return {
        "items": items[start : start + page_size],
        "page": page,
        "page_size": page_size,
        "total": total,
        "facets": facets,
    }
