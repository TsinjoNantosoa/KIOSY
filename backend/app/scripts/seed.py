import os
import secrets
from datetime import timedelta

from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password, utcnow
from app.db.base import SessionLocal
from app.db.models import (
    ContractDocumentVersion,
    Edition,
    EditorialStatus,
    Offer,
    OfferKind,
    Publication,
    Publisher,
    User,
)

DOCUMENTS = {
    "vente": (
        "Conditions de vente",
        [
            {
                "id": "achat-unite",
                "title": "Achat à l'unité",
                "body": "L'achat donne accès à l'édition et au périmètre indiqués dans l'offre acceptée.",
            },
            {
                "id": "renouvellement",
                "title": "Renouvellement",
                "body": "Le renouvellement du MVP est manuel et ne déclenche aucun prélèvement automatique.",
            },
        ],
    ),
    "utilisation": (
        "Conditions d'utilisation",
        [
            {"id": "compte", "title": "Compte personnel", "body": "Le compte et les droits sont personnels."},
            {
                "id": "assistant",
                "title": "Assistant KIA",
                "body": "KIA prépare les actions sensibles mais le service métier les exécute uniquement après confirmation.",
            },
        ],
    ),
    "confidentialite": (
        "Politique de confidentialité",
        [
            {
                "id": "donnees",
                "title": "Données",
                "body": "Les données nécessaires aux comptes, commandes, accès et demandes d'assistance sont traitées.",
            },
            {
                "id": "ia",
                "title": "IA",
                "body": "Un droit de lecture humaine n'autorise pas automatiquement l'envoi du contenu à un fournisseur IA.",
            },
        ],
    ),
}


def main() -> None:
    settings = get_settings()
    if settings.env not in {"development", "test"}:
        raise SystemExit("Seed refused outside development/test")
    password = os.getenv("KIOSY_SEED_PASSWORD")
    if not password or len(password) < 12:
        raise SystemExit("Set KIOSY_SEED_PASSWORD to a development-only password of at least 12 characters")
    with SessionLocal.begin() as db:
        if db.scalar(select(User.id).limit(1)):
            print("Seed skipped: database is not empty")
            return
        publishers = [
            Publisher(name="Éditions Baobab", is_demo=True),
            Publisher(name="Océan Livres", is_demo=True),
        ]
        db.add_all(publishers)
        db.flush()
        accounts = [
            ("reader1@example.com", "Aina Lectrice", ["reader"], None),
            ("reader2@example.com", "Miora Lectrice", ["reader"], None),
            ("publisher@example.com", "Éditeur Baobab", ["publisher"], publishers[0].id),
            ("support@example.com", "Support Kiosy", ["support"], None),
            ("manager@example.com", "Responsable Kiosy", ["manager"], None),
            ("admin@example.com", "Admin Kiosy", ["admin"], None),
        ]
        db.add_all(
            [
                User(
                    email=email,
                    display_name=name,
                    password_hash=hash_password(password),
                    roles=roles,
                    publisher_id=publisher_id,
                    is_demo=True,
                )
                for email, name, roles, publisher_id in accounts
            ]
        )
        now = utcnow()
        version = "mvp-2026-10-01"
        for document_id, (title, sections) in DOCUMENTS.items():
            db.add(
                ContractDocumentVersion(
                    document_id=document_id,
                    version=version,
                    title=title,
                    effective_at=now - timedelta(days=1),
                    source="backend",
                    sections=sections,
                    visibility="public",
                )
            )
        universes = ["presse", "business", "culture"]
        for index in range(15):
            publisher = publishers[index % 2]
            universe = universes[index % 3]
            publication = Publication(
                slug=f"publication-{index + 1}",
                title=f"Publication Kiosy {index + 1}",
                author=f"Auteur {index + 1}",
                publisher_id=publisher.id,
                universe=universe,
                language="fr",
                summary=f"Contenu fictif reproductible du jeu de développement {index + 1}.",
                tags=[universe, "demo"],
                cover={"palette": ["#17324d", "#f5efe0", "#d66b34"], "motif": "columns", "kicker": universe},
                kind="work",
                is_demo=True,
            )
            db.add(publication)
            db.flush()
            edition = Edition(
                publication_id=publication.id,
                label="Édition 1",
                published_at=now - timedelta(days=index),
                format="text" if index % 2 == 0 else "pdf",
                language="fr",
                status=EditorialStatus.published,
                availability={
                    "state": "available",
                    "territories": ["MG", "FR"],
                    "rights_valid_until": None,
                    "reason": None,
                },
                permissions={
                    "public_excerpt": True,
                    "ai_indexing": index % 3 != 0,
                    "full_text_public": False,
                },
                is_free=index < 3,
                version=1,
            )
            db.add(edition)
            db.flush()
            public_id = secrets.token_hex(16)
            price = 0 if index < 3 else 5000 + index * 500
            db.add(
                Offer(
                    offer_key=public_id,
                    version=1,
                    kind=OfferKind.free if price == 0 else OfferKind.single,
                    title=f"Accès — {publication.title}",
                    description="Offre fictive de développement.",
                    price_amount=price,
                    price_currency="MGA",
                    price_scale=0,
                    duration=None,
                    renewal="none",
                    scope={
                        "kind": "edition",
                        "edition_id": edition.id,
                        "publication_id": publication.id,
                        "label": edition.label,
                    },
                    restrictions=[],
                    conditions_version=version,
                    status="active",
                    quota_total=1 if index == 14 else None,
                    quota_remaining=1 if index == 14 else None,
                    is_demo=True,
                )
            )
        for universe in universes:
            db.add(
                Offer(
                    offer_key=secrets.token_hex(16),
                    version=1,
                    kind=OfferKind.subscription,
                    title=f"Abonnement {universe}",
                    description="Abonnement thématique fictif à renouvellement manuel.",
                    price_amount=25000,
                    price_currency="MGA",
                    price_scale=0,
                    duration={"unit": "month", "count": 1},
                    renewal="manual",
                    scope={
                        "kind": "collection",
                        "universe": universe,
                        "label": universe.title(),
                        "includes_future_additions": True,
                    },
                    restrictions=[],
                    conditions_version=version,
                    status="active",
                    is_demo=True,
                )
            )
    print("Seed completed: 2 publishers, 6 accounts, 15 publications and 18 offers")


if __name__ == "__main__":
    main()
