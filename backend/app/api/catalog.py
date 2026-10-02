from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.serializers import offer_out
from app.core.errors import DomainError
from app.db.base import get_db
from app.db.models import Edition, EditorialStatus
from app.domains.catalog_service import catalog, get_latest_offer, latest_offer_rows, publication_detail

router = APIRouter(prefix="/v1")


@router.get("/publications")
def search_publications(
    q: str | None = Query(default=None, max_length=200),
    universe: str | None = None,
    language: str | None = None,
    format: str | None = None,
    price: str | None = None,
    sort: str = "recent",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
) -> dict:
    return catalog(db, q=q, universe=universe, language=language, format=format, price=price, sort=sort, page=page, page_size=page_size)


@router.get("/publications/featured")
def featured(db: Session = Depends(get_db)) -> list[dict]:
    return catalog(
        db,
        q=None,
        universe=None,
        language=None,
        format=None,
        price=None,
        sort="recent",
        page=1,
        page_size=8,
    )["items"]


@router.get("/publications/{identifier}")
def publication(identifier: str, db: Session = Depends(get_db)) -> dict:
    return publication_detail(db, identifier)


@router.get("/editions/{edition_id}/excerpt")
def excerpt(edition_id: str, db: Session = Depends(get_db)) -> dict:
    edition = db.get(Edition, edition_id)
    if not edition or edition.status != EditorialStatus.published or not edition.permissions.get("public_excerpt"):
        raise DomainError(403, "EXCERPT_DENIED", "Aucun extrait public n'est disponible.")
    notice = "Extrait public limité. Le fichier complet n'est pas exposé."
    return {"edition_id": edition.id, "markdown": f"# {edition.label}\n\n{notice}", "truncated": True, "max_chars": 1500, "notice": notice}


@router.get("/offers")
def offers(publication_id: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    rows = latest_offer_rows(db)
    if publication_id:
        rows = [row for row in rows if row.scope.get("publication_id") == publication_id]
    return [offer_out(row) for row in rows]


@router.get("/offers/{offer_id}")
def offer(offer_id: str, db: Session = Depends(get_db)) -> dict:
    return offer_out(get_latest_offer(db, offer_id))


@router.get("/contract-documents/{document_id}/versions/{version}")
def contract_document(document_id: str, version: str, db: Session = Depends(get_db)) -> dict:
    from app.api.serializers import iso
    from app.db.models import ContractDocumentVersion
    row = db.scalar(select(ContractDocumentVersion).where(ContractDocumentVersion.document_id == document_id, ContractDocumentVersion.version == version))
    if not row:
        raise DomainError(404, "DOCUMENT_VERSION_NOT_FOUND", "Cette version du document n'existe pas.")
    if row.visibility != "public":
        raise DomainError(403, "DOCUMENT_FORBIDDEN", "Ce document n'est pas public.")
    return {"document_id": row.document_id, "version": row.version, "title": row.title, "effective_at": iso(row.effective_at), "source": row.source, "sections": row.sections}


@router.get("/contract-documents/{document_id}/current")
def current_contract_document(document_id: str, db: Session = Depends(get_db)) -> dict:
    from app.db.models import ContractDocumentVersion
    row = db.scalar(select(ContractDocumentVersion).where(ContractDocumentVersion.document_id == document_id, ContractDocumentVersion.visibility == "public").order_by(ContractDocumentVersion.effective_at.desc()).limit(1))
    if not row:
        raise DomainError(404, "DOCUMENT_NOT_FOUND", "Ce document contractuel n'est pas disponible.")
    return contract_document(document_id, row.version, db)
