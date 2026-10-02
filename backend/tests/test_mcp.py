import pytest
from mcp import Client
from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import User
from app.mcp.auth import issue_context
from app.mcp.servers import catalog_mcp, commerce_mcp

pytestmark = pytest.mark.postgres


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_real_mcp_initialization_discovery_and_invocation(database_url: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"])))
    async with Client(catalog_mcp, raise_exceptions=True) as client:
        tools = await client.list_tools()
        names = {tool.name for tool in tools.tools}
        assert names >= {"search_publications", "get_offer", "get_publication", "compare_offers"}
        token = issue_context(user.id, "catalog", ["catalog:read"])
        result = await client.call_tool("search_publications", {"context_token": token, "query": "Publication", "limit": 2})
        assert not result.is_error
        structured = result.structured_content
        payload = structured.get("result", structured)
        assert payload["total"] >= 2
    async with Client(commerce_mcp, raise_exceptions=True) as second_client:
        token = issue_context(user.id, "commerce", ["entitlements:read"])
        result = await second_client.call_tool("read_my_entitlements", {"context_token": token})
        assert not result.is_error
