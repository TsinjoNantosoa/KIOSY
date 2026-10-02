import asyncio
import concurrent.futures
from typing import Any

from mcp import Client
from mcp.server import MCPServer

from app.core.errors import DomainError
from app.mcp.auth import issue_context

_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="kiosy-mcp")


def _run_async(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    future = _executor.submit(asyncio.run, coro)
    return future.result(timeout=120)


class KiosyMcpClients:
    """Real MCP client used by KIA specialists (in-process Streamable HTTP servers)."""

    def __init__(self, user_id: str, trace_id: str, limits: dict[str, Any] | None = None):
        self.user_id = user_id
        self.trace_id = trace_id
        self.limits = limits or {}
        self.max_tool_calls = int(self.limits.get("max_tool_calls", 12))
        self.tool_calls = 0
        self.invocations: list[dict[str, Any]] = []

    async def _call_tool(self, server: MCPServer, audience: str, scopes: list[str], tool: str, arguments: dict[str, Any]) -> Any:
        if self.tool_calls >= self.max_tool_calls:
            raise DomainError(429, "TOOL_BUDGET_EXCEEDED", "Limite d'appels d'outils atteinte pour ce run.")
        token = issue_context(self.user_id, audience, scopes)
        payload = {**arguments, "context_token": token}
        async with Client(server, raise_exceptions=True) as client:
            result = await client.call_tool(tool, payload)
        self.tool_calls += 1
        if result.is_error:
            message = result.content[0].text if result.content else "MCP tool error"
            self.invocations.append({"tool": tool, "audience": audience, "trace_id": self.trace_id, "status": "error", "message": message[:300]})
            raise DomainError(502, "MCP_TOOL_FAILED", message)
        structured = result.structured_content or {}
        body = structured.get("result", structured)
        self.invocations.append({"tool": tool, "audience": audience, "trace_id": self.trace_id, "status": "ok", "tool_call_id": f"{self.trace_id}:{self.tool_calls}"})
        return body

    def call(self, server: MCPServer, audience: str, scopes: list[str], tool: str, **arguments: Any) -> Any:
        return _run_async(self._call_tool(server, audience, scopes, tool, arguments))
