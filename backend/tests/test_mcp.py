import socket
import subprocess
import sys
import time

import httpx
import pytest
from mcp import Client
from mcp.shared.exceptions import MCPError
from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import User
from app.mcp.auth import issue_context
from app.mcp.servers import catalog_mcp, commerce_mcp

pytestmark = pytest.mark.postgres


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
def mcp_http_base(database_url: str):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(  # noqa: S603
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],  # noqa: S603
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"MCP HTTP test server stopped: {stderr}")
        try:
            if httpx.get(f"{base}/health/ready", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    else:
        process.terminate()
        raise RuntimeError("MCP HTTP test server did not become ready")
    try:
        yield base
    finally:
        process.terminate()
        process.wait(timeout=10)


@pytest.mark.anyio
async def test_real_mcp_initialization_discovery_and_invocation(database_url: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )
    async with Client(catalog_mcp, raise_exceptions=True) as client:
        tools = await client.list_tools()
        names = {tool.name for tool in tools.tools}
        assert names >= {"search_publications", "get_offer", "get_publication", "compare_offers"}
        token = issue_context(user.id, "catalog", ["catalog:read"])
        result = await client.call_tool(
            "search_publications", {"context_token": token, "query": "Publication", "limit": 2}
        )
        assert not result.is_error
        structured = result.structured_content
        payload = structured.get("result", structured)
        assert payload["total"] >= 2
    async with Client(commerce_mcp, raise_exceptions=True) as second_client:
        token = issue_context(user.id, "commerce", ["entitlements:read"])
        result = await second_client.call_tool("read_my_entitlements", {"context_token": token})
        assert not result.is_error


@pytest.mark.anyio
async def test_streamable_http_initialization_discovery_calls_and_security(
    database_url: str, mcp_http_base: str
) -> None:
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )

    async with Client(f"{mcp_http_base}/mcp/catalog/", raise_exceptions=True) as client:
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert names >= {"search_publications", "get_publication", "compare_offers"}
        token = issue_context(user.id, "catalog", ["catalog:read"])
        result = await client.call_tool(
            "search_publications", {"context_token": token, "query": "Publication", "limit": 1}
        )
        assert not result.is_error
        with pytest.raises(MCPError):
            await client.call_tool(
                "search_publications",
                {"context_token": token, "query": "", "limit": 1, "unexpected": True},
            )
        with pytest.raises(MCPError):
            await client.call_tool("execute_sql", {"context_token": token})

    async with Client(f"{mcp_http_base}/mcp/commerce/", raise_exceptions=True) as client:
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert names >= {"get_my_subscriptions", "check_entitlement", "prepare_purchase"}
        wrong_audience = issue_context(user.id, "catalog", ["subscriptions:read"])
        denied = await client.call_tool("get_my_subscriptions", {"context_token": wrong_audience})
        assert denied.is_error

    async with Client(f"{mcp_http_base}/mcp/assistance/", raise_exceptions=True) as client:
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert names >= {"search_terms", "diagnose_access", "create_support_case", "get_my_case"}
        token = issue_context(user.id, "assistance", ["documents:read"])
        result = await client.call_tool(
            "search_terms",
            {"context_token": token, "version": "mvp-2026-10-01", "query": "renouvellement"},
        )
        assert not result.is_error
