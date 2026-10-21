import argparse
import json

from app.ai.ingestion import rebuild_all
from app.ai.providers import embedding_provider_from_settings
from app.ai.retrieval import RetrievalIndex
from app.core.config import get_settings
from app.db.base import SessionLocal


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild or inspect the Kiosy RAG index.")
    parser.add_argument("--health", action="store_true", help="Only print index health.")
    parser.add_argument(
        "--skip-existing-content", action="store_true", help="Only rebuild catalog and contracts."
    )
    args = parser.parse_args()
    settings = get_settings()
    provider = embedding_provider_from_settings(settings)
    index = RetrievalIndex(settings, provider)
    with SessionLocal.begin() as db:
        result = (
            index.health(db)
            if args.health
            else rebuild_all(db, index, include_existing_content=not args.skip_existing_content)
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
