from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import admin
from app.api.schemas import EditionInput, PublicationCreateInput, PublicationInput
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import require_roles
from app.db.base import get_db
from app.db.models import (
    Asset,
    Edition,
    EditorialReview,
    EditorialStatus,
    Entitlement,
    ImportJob,
    Order,
    Publication,
    Publisher,
    User,
)

router = APIRouter(prefix="/v1/publisher", tags=["publisher"])
review_router = APIRouter(prefix="/v1/admin/editorial", tags=["editorial-review"])


class ReviewDecisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["changes_requested", "approved"]
    comment: str = Field(min_length=1, max_length=4000)
    version: int = Field(gt=0)


def _publisher_id(user: User) -> str:
    if not user.publisher_id:
        raise DomainError(403, "PUBLISHER_NOT_LINKED", "Ce compte n'est lié à aucun éditeur.")
    return user.publisher_id


def _owned_edition(db: Session, user: User, edition_id: str, *, lock: bool = False) -> tuple[Edition, Publication]:
    statement = (
        select(Edition, Publication)
        .join(Publication, Publication.id == Edition.publication_id)
        .where(Edition.id == edition_id, Publication.publisher_id == _publisher_id(user))
    )
    if lock:
        statement = statement.with_for_update()
    row = db.execute(statement).one_or_none()
    if not row:
        raise DomainError(404, "NOT_FOUND", "Édition introuvable.")
    return row[0], row[1]


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db), user: User = Depends(require_roles("publisher"))
) -> dict:
    publisher_id = _publisher_id(user)
    edition_rows = list(
        db.execute(
            select(Edition, Publication)
            .join(Publication, Publication.id == Edition.publication_id)
            .where(Publication.publisher_id == publisher_id)
        )
    )
    edition_ids = [edition.id for edition, _ in edition_rows]
    statuses = [edition.status.value for edition, _ in edition_rows]
    recent = []
    if edition_ids:
        recent = [
            admin.import_out(job, edition)
            for job, edition in db.execute(
                select(ImportJob, Edition)
                .join(Edition, Edition.id == ImportJob.edition_id)
                .where(ImportJob.edition_id.in_(edition_ids))
                .order_by(ImportJob.created_at.desc())
                .limit(8)
            )
        ]
    return {
        "publisher_id": publisher_id,
        "counts": {
            "publications": db.scalar(
                select(func.count()).select_from(Publication).where(Publication.publisher_id == publisher_id)
            )
            or 0,
            "editions": len(edition_rows),
            "drafts": statuses.count("draft"),
            "pending_review": statuses.count("review"),
            "changes_requested": statuses.count("changes_requested"),
            "approved": statuses.count("approved"),
            "published": statuses.count("published"),
            "failed_imports": sum(1 for item in recent if item["status"] == "failed"),
        },
        "recent_imports": recent,
    }


@router.get("/publications")
def publications(
    status: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
) -> list[dict]:
    return admin.editions(status=status, q=q, db=db, user=user)


@router.post("/publications", status_code=201)
def create_publication(
    payload: PublicationCreateInput,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
) -> dict:
    if payload.publisher_id != _publisher_id(user):
        raise DomainError(404, "NOT_FOUND", "Éditeur introuvable.")
    return admin.create_publication(payload=payload, db=db, user=user)


@router.patch("/publications/{publication_id}")
def update_publication(
    publication_id: str,
    payload: PublicationInput,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
) -> dict:
    return admin.update_publication(publication_id=publication_id, payload=payload, db=db, user=user)


@router.post("/publications/{publication_id}/editions", status_code=201)
def create_edition(
    publication_id: str,
    payload: EditionInput,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
) -> dict:
    return admin.create_edition(publication_id=publication_id, payload=payload, db=db, user=user)


@router.get("/editions/{edition_id}")
def edition(
    edition_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
) -> dict:
    return admin.edition(edition_id=edition_id, db=db, user=user)


@router.patch("/editions/{edition_id}")
def update_edition(
    edition_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
) -> dict:
    return admin.update_edition(edition_id=edition_id, payload=payload, db=db, user=user)


@router.post("/editions/{edition_id}/submit")
def submit(
    edition_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
) -> dict:
    edition, _ = _owned_edition(db, user, edition_id)
    if not edition.asset_id or not db.scalar(
        select(Asset.id).where(Asset.id == edition.asset_id, Asset.status == "ready")
    ):
        raise DomainError(409, "ASSET_NOT_READY", "Un fichier ingéré avec succès est requis avant soumission.")
    reason = str(payload.get("reason", "Soumission éditeur"))[:500]
    return admin.transition(
        edition_id=edition_id,
        payload={"to": "review", "version": payload.get("version"), "reason": reason},
        db=db,
        user=user,
    )


@router.post("/imports", status_code=202)
async def upload_import(
    edition_id: str = Form(...),
    file: UploadFile = File(...),
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("publisher")),
    settings: Settings = Depends(get_settings),
) -> dict:
    return await admin.upload_import(
        edition_id=edition_id,
        file=file,
        idempotency_key=idempotency_key,
        db=db,
        user=user,
        settings=settings,
    )


@router.get("/imports")
def imports(
    db: Session = Depends(get_db), user: User = Depends(require_roles("publisher"))
) -> list[dict]:
    return admin.imports(db=db, user=user)


@router.get("/reviews")
def reviews(
    db: Session = Depends(get_db), user: User = Depends(require_roles("publisher"))
) -> list[dict]:
    rows = db.execute(
        select(EditorialReview, Edition, Publication)
        .join(Edition, Edition.id == EditorialReview.edition_id)
        .join(Publication, Publication.id == Edition.publication_id)
        .where(Publication.publisher_id == _publisher_id(user))
        .order_by(EditorialReview.created_at.desc())
    )
    return [
        {
            "id": review.id,
            "edition_id": edition.id,
            "edition_label": edition.label,
            "publication_title": publication.title,
            "decision": review.decision,
            "comment": review.comment,
            "created_at": review.created_at.isoformat(),
        }
        for review, edition, publication in rows
    ]


@router.get("/analytics")
def analytics(
    db: Session = Depends(get_db), user: User = Depends(require_roles("publisher"))
) -> dict:
    publication_ids = list(
        db.scalars(select(Publication.id).where(Publication.publisher_id == _publisher_id(user)))
    )
    edition_ids = list(db.scalars(select(Edition.id).where(Edition.publication_id.in_(publication_ids)))) if publication_ids else []
    orders = db.scalar(select(func.count()).select_from(Order).where(Order.edition_id.in_(edition_ids))) if edition_ids else 0
    entitlements = 0
    if edition_ids:
        entitlements = sum(
            1
            for scope in db.scalars(select(Entitlement.scope))
            if scope.get("kind") == "edition" and scope.get("edition_id") in set(edition_ids)
        )
    return {
        "publications": len(publication_ids),
        "editions": len(edition_ids),
        "orders": orders or 0,
        "entitlements": entitlements,
    }


@review_router.get("/submissions")
def submissions(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("manager", "admin")),
) -> list[dict]:
    del user
    rows = db.execute(
        select(Edition, Publication, Publisher)
        .join(Publication, Publication.id == Edition.publication_id)
        .join(Publisher, Publisher.id == Publication.publisher_id)
        .where(Edition.status.in_([EditorialStatus.review, EditorialStatus.approved]))
        .order_by(Edition.updated_at)
    )
    return [
        {
            "edition": admin.edition_out(edition),
            "publication": admin.publication_out(publication, publisher),
            "publisher": {"id": publisher.id, "name": publisher.name},
        }
        for edition, publication, publisher in rows
    ]


@review_router.post("/editions/{edition_id}/decision")
def decide(
    edition_id: str,
    payload: ReviewDecisionInput,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    edition = db.get(Edition, edition_id)
    if not edition or edition.status != EditorialStatus.review:
        raise DomainError(409, "INVALID_TRANSITION", "Cette édition n'est pas en attente de revue.")
    result = admin.transition(
        edition_id=edition_id,
        payload={"to": payload.decision, "version": payload.version, "reason": payload.comment},
        db=db,
        user=user,
    )
    return result
