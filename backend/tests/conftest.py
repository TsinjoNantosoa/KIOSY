import os

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def database_url() -> str:
    value = os.getenv("KIOSY_DATABASE_URL")
    if not value or "postgresql" not in value:
        pytest.skip("KIOSY_DATABASE_URL must point to the PostgreSQL integration database")
    return value


@pytest.fixture(scope="session")
def client(database_url: str):
    with TestClient(app) as value:
        yield value
