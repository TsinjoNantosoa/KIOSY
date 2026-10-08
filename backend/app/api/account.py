from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.serializers import edition_out, iso, publication_out
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import current_user, utcnow
from app.db.base import get_db
from app.db.models import Asset, Edition, Entitlement, Publication, Publisher, Subscription, User
from app.domains.storage import S3Storage

router = APIRouter(prefix="/v1")


def entitlement_out(row: Entitlement) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "source": row.source,
        "source_ref": row.source_ref,
        "scope": row.scope,
        "valid_from": iso(row.valid_from),
        "valid_until": iso(row.valid_until),
        "status": row.status,
    }


def active_entitlements(db: Session, user_id: str) -> list[Entitlement]:
    now = utcnow()
    return list(
        db.scalars(
            select(Entitlement).where(
                Entitlement.user_id == user_id,
                Entitlement.status == "active",
                or_(Entitlement.valid_until.is_(None), Entitlement.valid_until > now),
            )
        )
    )


def can_read(edition: Edition, publication: Publication, entitlements: list[Entitlement]) -> bool:
    if edition.is_free:
        return True
    return any(
        (row.scope.get("kind") == "edition" and row.scope.get("edition_id") == edition.id)
        or (row.scope.get("kind") == "collection" and row.scope.get("universe") == publication.universe)
        for row in entitlements
    )


@router.get("/me/library")
def library(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict]:
    rights = active_entitlements(db, user.id)
    rows = db.execute(
        select(Edition, Publication, Publisher)
        .join(Publication, Publication.id == Edition.publication_id)
        .join(Publisher, Publisher.id == Publication.publisher_id)
        .where(Edition.status == "published")
    ).all()
    result = []
    for edition, publication, publisher in rows:
        entitlement = next((right for right in rights if can_read(edition, publication, [right])), None)
        if entitlement:
            result.append(
                {
                    "edition": edition_out(edition),
                    "publication": publication_out(publication, publisher),
                    "entitlement": entitlement_out(entitlement),
                }
            )
    return result


@router.get("/me/access")
def access(publication_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    publication = db.get(Publication, publication_id)
    if not publication:
        raise DomainError(404, "NOT_FOUND", "Publication introuvable.")
    rights = active_entitlements(db, user.id)
    editions = db.scalars(select(Edition).where(Edition.publication_id == publication.id)).all()
    readable = [edition.id for edition in editions if can_read(edition, publication, rights)]
    return {
        "publication_id": publication.id,
        "readable_edition_ids": readable,
        "entitlements": [entitlement_out(row) for row in rights],
    }


@router.get("/editions/{edition_id}/asset")
def edition_asset(edition_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    edition = db.get(Edition, edition_id)
    if not edition or not edition.asset_id:
        raise DomainError(404, "NOT_FOUND", "Fichier introuvable.")
    publication = db.get(Publication, edition.publication_id)
    if not publication or not can_read(edition, publication, active_entitlements(db, user.id)):
        raise DomainError(403, "ACCESS_DENIED", "Vous ne disposez pas du droit de lecture.")
    return {"asset_id": edition.asset_id}


@router.get("/assets/{asset_id}/access")
def asset_access(
    asset_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    asset = db.get(Asset, asset_id)
    if not asset or asset.status != "ready":
        raise DomainError(404, "NOT_FOUND", "Fichier indisponible.")
    edition = db.get(Edition, asset.edition_id)
    publication = db.get(Publication, edition.publication_id) if edition else None
    if not edition or not publication or not can_read(edition, publication, active_entitlements(db, user.id)):
        raise DomainError(403, "ACCESS_DENIED", "Vous ne disposez pas du droit de lecture.")
    storage = S3Storage(settings)
    extension = "pdf" if asset.media_type == "application/pdf" else "md"
    url, expires_at = storage.presigned_get(
        asset.object_key, f"{publication.slug}-{edition.label}.{extension}", False
    )
    return {
        "asset_id": asset.id,
        "edition_id": edition.id,
        "title": publication.title,
        "edition_label": edition.label,
        "publication_slug": publication.slug,
        "format": edition.format,
        "url": url,
        "media_type": asset.media_type,
        "expires_at": expires_at,
        "download_allowed": asset.download_allowed,
    }


@router.get("/me/subscriptions")
def subscriptions(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict]:
    return [
        subscription_out(row)
        for row in db.scalars(
            select(Subscription)
            .where(Subscription.user_id == user.id)
            .order_by(Subscription.created_at.desc())
        )
    ]


def subscription_out(row: Subscription) -> dict:
    return {
        "id": row.id,
        "offer": row.offer_snapshot,
        "universe": row.universe,
        "status": "cancel_at_period_end"
        if row.cancel_at_period_end and row.status == "active"
        else row.status,
        "current_period_start": iso(row.current_period_start),
        "current_period_end": iso(row.current_period_end),
        "renewal": "manual",
        "scope_label": row.offer_snapshot.get("scope_label", row.offer_snapshot["title"]),
        "scheduled_change": row.scheduled_change,
        "history": row.history,
    }


@router.get("/me/subscriptions/{subscription_id}")
def subscription(
    subscription_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    row = db.scalar(
        select(Subscription).where(Subscription.id == subscription_id, Subscription.user_id == user.id)
    )
    if not row:
        raise DomainError(404, "NOT_FOUND", "Abonnement introuvable.")
    return subscription_out(row)
