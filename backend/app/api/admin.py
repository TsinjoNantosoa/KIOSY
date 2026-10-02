import hashlib
import secrets

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import EditionInput, OfferCreateInput, PublicationCreateInput, PublicationInput
from app.api.serializers import edition_out, offer_out, publication_out, publisher_out
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import require_roles
from app.db.base import get_db
from app.db.models import (
    Edition,
    EditorialStatus,
    ImportJob,
    Offer,
    OfferKind,
    Publication,
    Publisher,
    User,
)
from app.domains.catalog_service import latest_offer_rows, slugify
from app.domains.commerce_service import enqueue
from app.domains.idempotency import begin, complete
from app.domains.storage import S3Storage

router = APIRouter(prefix="/v1/admin")


def assert_publisher_scope(user: User, publisher_id: str) -> None:
    if "admin" not in user.roles and user.publisher_id != publisher_id:
        raise DomainError(404, "NOT_FOUND", "Ressource introuvable.")


@router.get("/publishers")
def publishers(db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "manager", "admin"))) -> list[dict]:
    statement = select(Publisher).order_by(Publisher.name)
    if "admin" not in user.roles and user.publisher_id:
        statement = statement.where(Publisher.id == user.publisher_id)
    return [publisher_out(row) for row in db.scalars(statement)]


@router.post("/publications", status_code=201)
def create_publication(payload: PublicationCreateInput, db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "admin"))) -> dict:
    assert_publisher_scope(user, payload.publisher_id)
    publisher = db.get(Publisher, payload.publisher_id)
    if not publisher:
        raise DomainError(404, "NOT_FOUND", "Éditeur introuvable.")
    base_slug = slugify(payload.title)
    slug = base_slug
    suffix = 2
    while db.scalar(select(Publication.id).where(Publication.slug == slug)):
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    publication = Publication(slug=slug, title=payload.title, author=payload.author, publisher_id=publisher.id, universe=payload.universe, language=payload.language, summary=payload.summary, tags=payload.tags, cover={"palette": ["#17324d", "#f5efe0", "#d66b34"], "motif": "columns", "kicker": payload.universe}, kind="work")
    db.add(publication)
    db.flush()
    edition = make_edition(publication, payload.edition)
    db.add(edition)
    db.commit()
    return {"edition": edition_out(edition), "publication": publication_out(publication, publisher)}


@router.patch("/publications/{publication_id}")
def update_publication(publication_id: str, payload: PublicationInput, db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "admin"))) -> dict:
    row = db.get(Publication, publication_id)
    if not row:
        raise DomainError(404, "NOT_FOUND", "Publication introuvable.")
    assert_publisher_scope(user, row.publisher_id)
    assert_publisher_scope(user, payload.publisher_id)
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    db.commit()
    return publication_out(row, db.get(Publisher, row.publisher_id))


def make_edition(publication: Publication, payload: EditionInput) -> Edition:
    return Edition(publication_id=publication.id, label=payload.label, published_at=payload.published_at, format=payload.format, language=publication.language, status=EditorialStatus.draft, availability={"state": "unavailable", "territories": [], "rights_valid_until": None, "reason": "Brouillon"}, permissions=payload.permissions, is_free=payload.is_free, version=1)


@router.post("/publications/{publication_id}/editions", status_code=201)
def create_edition(publication_id: str, payload: EditionInput, db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "admin"))) -> dict:
    publication = db.get(Publication, publication_id)
    if not publication:
        raise DomainError(404, "NOT_FOUND", "Publication introuvable.")
    assert_publisher_scope(user, publication.publisher_id)
    edition = make_edition(publication, payload)
    db.add(edition)
    db.commit()
    return {"edition": edition_out(edition), "publication": publication_out(publication, db.get(Publisher, publication.publisher_id))}


@router.get("/editions")
def editions(status: str | None = None, q: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "manager", "admin"))) -> list[dict]:
    statement = select(Edition, Publication, Publisher).join(Publication, Publication.id == Edition.publication_id).join(Publisher, Publisher.id == Publication.publisher_id)
    if status:
        statement = statement.where(Edition.status == status)
    if q:
        statement = statement.where(Publication.title.ilike(f"%{q}%"))
    if "admin" not in user.roles:
        statement = statement.where(Publication.publisher_id == user.publisher_id)
    return [{"edition": edition_out(edition), "publication": publication_out(publication, publisher)} for edition, publication, publisher in db.execute(statement.order_by(Edition.updated_at.desc()))]


@router.get("/editions/{edition_id}")
def edition(edition_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "manager", "admin"))) -> dict:
    row = db.get(Edition, edition_id)
    publication = db.get(Publication, row.publication_id) if row else None
    if not row or not publication:
        raise DomainError(404, "NOT_FOUND", "Édition introuvable.")
    assert_publisher_scope(user, publication.publisher_id)
    return {"edition": edition_out(row), "publication": publication_out(publication, db.get(Publisher, publication.publisher_id))}


@router.patch("/editions/{edition_id}")
def update_edition(edition_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "admin"))) -> dict:
    expected = {"label", "format", "published_at", "permissions", "is_free", "version"}
    if set(payload) != expected:
        raise DomainError(422, "INVALID_BODY", "Le corps de modification est invalide.")
    row = db.scalar(select(Edition).where(Edition.id == edition_id).with_for_update())
    publication = db.get(Publication, row.publication_id) if row else None
    if not row or not publication:
        raise DomainError(404, "NOT_FOUND", "Édition introuvable.")
    assert_publisher_scope(user, publication.publisher_id)
    if row.version != payload["version"]:
        raise DomainError(409, "VERSION_CONFLICT", "L'édition a été modifiée.")
    validated = EditionInput.model_validate({key: payload[key] for key in expected - {"version"}})
    for field, value in validated.model_dump().items():
        setattr(row, field, value)
    row.version += 1
    db.commit()
    return {"edition": edition_out(row), "publication": publication_out(publication, db.get(Publisher, publication.publisher_id))}


@router.post("/editions/{edition_id}/transitions")
def transition(edition_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "admin"))) -> dict:
    if set(payload) != {"to", "version", "reason"}:
        raise DomainError(422, "INVALID_BODY", "Le corps de transition est invalide.")
    row = db.scalar(select(Edition).where(Edition.id == edition_id).with_for_update())
    publication = db.get(Publication, row.publication_id) if row else None
    if not row or not publication:
        raise DomainError(404, "NOT_FOUND", "Édition introuvable.")
    assert_publisher_scope(user, publication.publisher_id)
    if row.version != payload["version"]:
        raise DomainError(409, "VERSION_CONFLICT", "L'édition a été modifiée.")
    allowed = {"draft": {"review", "archived"}, "review": {"draft", "published"}, "published": {"suspended", "archived"}, "suspended": {"published", "archived"}, "archived": set()}
    if payload["to"] not in allowed[row.status.value]:
        raise DomainError(409, "INVALID_TRANSITION", "Cette transition éditoriale est interdite.")
    if payload["to"] == "published" and not row.asset_id:
        raise DomainError(409, "ASSET_NOT_READY", "Un fichier prêt est requis avant publication.")
    row.status = EditorialStatus(payload["to"])
    row.version += 1
    if row.status == EditorialStatus.published:
        row.availability = {"state": "available", "territories": ["MG", "FR"], "rights_valid_until": None, "reason": None}
    db.commit()
    return {"edition": edition_out(row), "publication": publication_out(publication, db.get(Publisher, publication.publisher_id))}


@router.get("/offers")
def admin_offers(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))) -> list[dict]:
    return [offer_out(row) for row in latest_offer_rows(db)]


@router.post("/offers", status_code=201)
def create_offer(payload: OfferCreateInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))) -> dict:
    public_id = secrets.token_hex(16)
    row = Offer(offer_key=public_id, version=1, kind=OfferKind(payload.kind), title=payload.title, description=payload.description, price_amount=payload.price.amount, price_currency=payload.price.currency, price_scale=payload.price.scale, duration=payload.duration.model_dump() if payload.duration else None, renewal="manual" if payload.kind == "subscription" else "none", scope=payload.scope, restrictions=payload.restrictions, conditions_version=payload.conditions_version, status=payload.status, quota_total=payload.quota_total, quota_remaining=payload.quota_total)
    db.add(row)
    db.commit()
    return offer_out(row)


@router.get("/offers/{offer_id}/versions")
def offer_versions(offer_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))) -> list[dict]:
    return [offer_out(row) for row in db.scalars(select(Offer).where(Offer.offer_key == offer_id).order_by(Offer.version.desc()))]


@router.post("/offers/{offer_id}/versions", status_code=201)
def create_offer_version(offer_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))) -> dict:
    expected = {"title", "description", "price_amount", "restrictions", "status", "version"}
    if set(payload) != expected:
        raise DomainError(422, "INVALID_BODY", "Le corps de version est invalide.")
    current = db.scalar(select(Offer).where(Offer.offer_key == offer_id).order_by(Offer.version.desc()).with_for_update())
    if not current:
        raise DomainError(404, "NOT_FOUND", "Offre introuvable.")
    if payload["version"] != current.version:
        raise DomainError(409, "VERSION_CONFLICT", "L'offre a été modifiée.")
    if not isinstance(payload["price_amount"], int) or payload["price_amount"] < 0:
        raise DomainError(422, "INVALID_PRICE", "Le prix doit être un entier positif ou nul.")
    row = Offer(
        offer_key=current.offer_key,
        version=current.version + 1,
        kind=current.kind,
        title=str(payload["title"]).strip(),
        description=str(payload["description"]).strip(),
        price_amount=payload["price_amount"],
        price_currency=current.price_currency,
        price_scale=current.price_scale,
        duration=current.duration,
        renewal=current.renewal,
        scope=current.scope,
        restrictions=payload["restrictions"],
        conditions_version=current.conditions_version,
        status=payload["status"],
        quota_total=current.quota_total,
        quota_remaining=current.quota_remaining,
        is_demo=current.is_demo,
    )
    db.add(row)
    db.commit()
    return offer_out(row)


@router.post("/imports", status_code=202)
async def upload_import(edition_id: str = Form(...), file: UploadFile = File(...), idempotency_key: str | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "admin")), settings: Settings = Depends(get_settings)) -> dict:
    edition = db.get(Edition, edition_id)
    publication = db.get(Publication, edition.publication_id) if edition else None
    if not edition or not publication:
        raise DomainError(404, "NOT_FOUND", "Édition introuvable.")
    assert_publisher_scope(user, publication.publisher_id)
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise DomainError(422, "FILE_TOO_LARGE", "Le fichier dépasse la taille maximale.")
    is_pdf = content.startswith(b"%PDF-")
    is_text = file.content_type in {"text/plain", "text/markdown"}
    if not is_pdf and not is_text:
        raise DomainError(422, "UNSUPPORTED_FILE", "Seuls PDF et texte sont acceptés.")
    digest = hashlib.sha256(content).hexdigest()
    operation, replay = begin(db, user.id, "upload_import", idempotency_key, {"edition_id": edition_id, "sha256": digest, "size": len(content)})
    if replay is not None:
        return replay
    media_type = "application/pdf" if is_pdf else "text/markdown"
    object_key = f"quarantine/{publication.publisher_id}/{edition.id}/{digest}"
    S3Storage(settings).upload(object_key, content, media_type)
    job = ImportJob(edition_id=edition.id, file_name=(file.filename or "fichier")[:255], size_bytes=len(content), media_type=media_type, object_key=object_key, status="quarantined", progress=5)
    db.add(job)
    db.flush()
    enqueue(db, "ingest_asset", {"import_id": job.id})
    result = import_out(job, edition)
    complete(operation, result, 202, "import", job.id)
    db.commit()
    return result


def import_out(row: ImportJob, edition: Edition | None = None) -> dict:
    return {"id": row.id, "file_name": row.file_name, "size_bytes": row.size_bytes, "media_type": row.media_type, "edition_id": row.edition_id, "edition_label": edition.label if edition else None, "status": row.status, "progress": row.progress, "error": row.error, "warnings": row.warnings, "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat()}


@router.get("/imports")
def imports(db: Session = Depends(get_db), user: User = Depends(require_roles("publisher", "admin"))) -> list[dict]:
    statement = select(ImportJob, Edition, Publication).join(Edition, Edition.id == ImportJob.edition_id).join(Publication, Publication.id == Edition.publication_id)
    if "admin" not in user.roles:
        statement = statement.where(Publication.publisher_id == user.publisher_id)
    return [import_out(job, edition) for job, edition, _ in db.execute(statement.order_by(ImportJob.created_at.desc()))]
