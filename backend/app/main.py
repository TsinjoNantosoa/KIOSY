import re
import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy import text
from starlette.routing import Mount

from app.api import (
    account,
    admin,
    admin_views,
    assistant,
    auth,
    catalog,
    commerce,
    proposals,
    publisher,
    rag,
    support,
)
from app.core.config import get_settings
from app.core.errors import DomainError, install_error_handlers
from app.core.security import CSRF_BINDING_COOKIE, validate_csrf
from app.db.base import engine
from app.mcp.servers import assistance_mcp, catalog_mcp, commerce_mcp

settings = get_settings()
transport_security = TransportSecuritySettings(
    allowed_hosts=settings.mcp_allowed_hosts,
    allowed_origins=settings.mcp_allowed_origins,
)
catalog_mcp_app = catalog_mcp.streamable_http_app(
    streamable_http_path="/", transport_security=transport_security
)
commerce_mcp_app = commerce_mcp.streamable_http_app(
    streamable_http_path="/", transport_security=transport_security
)
assistance_mcp_app = assistance_mcp.streamable_http_app(
    streamable_http_path="/", transport_security=transport_security
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(catalog_mcp.session_manager.run())
        await stack.enter_async_context(commerce_mcp.session_manager.run())
        await stack.enter_async_context(assistance_mcp.session_manager.run())
        yield


app = FastAPI(
    title="Kiosy API",
    version="0.1.0",
    docs_url="/docs" if settings.env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key", "Last-Event-ID"],
    expose_headers=["X-Request-ID", "Mcp-Session-Id"],
)
install_error_handlers(app)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    path = request.url.path
    csrf_exempt = (
        request.method in {"GET", "HEAD", "OPTIONS"}
        or path.startswith("/mcp/")
        or path.startswith("/v1/webhooks/")
        or bool(re.fullmatch(r"/v1/test-payments/[^/]+/complete", path))
    )
    if not csrf_exempt:
        try:
            validate_csrf(
                request.headers.get("X-CSRF-Token"), request.cookies.get(CSRF_BINDING_COOKIE), settings
            )
        except DomainError as exc:
            return JSONResponse(
                status_code=exc.status,
                content={
                    "code": exc.code,
                    "message": exc.message,
                    "details": [],
                    "request_id": request.state.request_id,
                },
            )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.get("/health/live", include_in_schema=False)
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready", include_in_schema=False)
def ready() -> dict[str, str]:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ready"}


for router in (
    auth.router,
    catalog.router,
    commerce.router,
    account.router,
    assistant.router,
    support.router,
    proposals.router,
    publisher.router,
    admin.router,
    admin_views.router,
    publisher.review_router,
    rag.router,
):
    app.include_router(router)

app.routes.extend(
    [
        Mount("/mcp/catalog", app=catalog_mcp_app),
        Mount("/mcp/commerce", app=commerce_mcp_app),
        Mount("/mcp/assistance", app=assistance_mcp_app),
    ]
)
