from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

from fastapi import HTTPException
from fastmcp.server.dependencies import get_http_headers
from opentelemetry import trace

from api.db.models import UserModel
from api.services.auth.depends import _handle_api_key_auth

# Set only by server-side code that invokes MCP tools in-process on behalf
# of a user it has already authenticated (e.g. the in-app agent copilot).
# Never derived from request input, so it cannot be spoofed by MCP clients.
_in_process_user: ContextVar[UserModel | None] = ContextVar(
    "mcp_in_process_user", default=None
)


@contextmanager
def acting_as(user: UserModel) -> Iterator[None]:
    """Run MCP tools in-process as ``user``, bypassing the API-key headers."""
    token = _in_process_user.set(user)
    try:
        yield
    finally:
        _in_process_user.reset(token)


async def authenticate_mcp_request() -> UserModel:
    """Resolve the authenticated Dograh user for an MCP tool invocation.

    Accepts either `X-API-Key: <key>` or `Authorization: Bearer <key>`,
    reusing the API-key flow from `api.services.auth.depends`. In-process
    callers that already hold an authenticated user use `acting_as`
    instead.

    Tags the currently-active OTel span with the resolved organization
    and user identifiers. `_OrgRoutingExporter` reads `dograh.org_id`
    at export time to dispatch the span to the right Langfuse project;
    the `langfuse.user.id` / `langfuse.session.id` attributes make the
    span filterable in the Langfuse UI.
    """
    user = _in_process_user.get()
    if user is None:
        user = await _authenticate_from_headers()

    span = trace.get_current_span()
    if span.is_recording():
        org_id = user.selected_organization_id
        # Intentionally NOT `dograh.org_id` — that attribute triggers the
        # per-org Langfuse routing for pipeline spans, and MCP traffic
        # should land in the default (developer-facing) project only.
        # Exposed under `mcp.org_id` for Langfuse UI filtering without
        # affecting the router.
        span.set_attribute("mcp.org_id", str(org_id))
        span.set_attribute("mcp.user_id", str(user.id))
        span.set_attribute("langfuse.user.id", str(user.id))

    return user


async def _authenticate_from_headers() -> UserModel:
    # FastMCP strips Authorization by default unless explicitly included.
    # Preserve it here so Bearer API keys work for MCP tool invocations.
    headers = get_http_headers(include={"authorization"})
    api_key = headers.get("x-api-key")
    if not api_key:
        auth = headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            api_key = auth.split(" ", 1)[1].strip()
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing API key — send X-API-Key or Authorization: Bearer <key>",
        )
    return await _handle_api_key_auth(api_key)
