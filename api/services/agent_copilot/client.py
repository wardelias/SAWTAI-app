"""Shared Anthropic clients for the AI Assistant features.

One client per API key (organizations can bring their own), reused for
connection pooling. Bounded so rotated keys don't accumulate.
"""

from __future__ import annotations

from collections import OrderedDict

import anthropic

_MAX_CLIENTS = 64
_clients: OrderedDict[str, anthropic.AsyncAnthropic] = OrderedDict()


def get_client(api_key: str) -> anthropic.AsyncAnthropic:
    client = _clients.get(api_key)
    if client is None:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        _clients[api_key] = client
        while len(_clients) > _MAX_CLIENTS:
            _clients.popitem(last=False)
    else:
        _clients.move_to_end(api_key)
    return client


def api_error_detail(e: anthropic.APIError) -> str | None:
    """Anthropic's own explanation from an error response, if any."""
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"].strip()[:300] or None
    return None


def api_error_message(e: anthropic.APIError, model: str | None = None) -> str:
    """A user-facing explanation of an Anthropic API failure.

    Passes Anthropic's own message through for request errors (e.g. "Your
    credit balance is too low…"), since that is what the user needs to act
    on; it never contains the key.
    """
    detail = api_error_detail(e)
    if isinstance(e, anthropic.AuthenticationError):
        return "Anthropic rejected the API key. Check it in Settings → AI Assistant."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "This API key isn't allowed to make this request" + (
            f": {detail}" if detail else "."
        )
    if isinstance(e, anthropic.NotFoundError):
        return (
            f"{model or 'The selected model'} isn't available for this API key. "
            "Choose another model in Settings → AI Assistant."
        )
    if isinstance(e, anthropic.RateLimitError):
        return "The assistant is busy right now (rate limit). Please try again in a minute."
    if isinstance(e, anthropic.RequestTooLargeError):
        return "This conversation has grown too large. Start a new chat."
    if isinstance(
        e,
        (
            anthropic.OverloadedError,
            anthropic.ServiceUnavailableError,
            anthropic.InternalServerError,
        ),
    ):
        return "Anthropic is having a temporary problem. Please try again in a minute."
    if isinstance(e, anthropic.APIConnectionError):
        return "Couldn't reach Anthropic. Please try again."
    if detail:
        return f"Anthropic couldn't process the request: {detail}"
    return "The assistant hit an error talking to Anthropic. Please try again."


# (api_key, model) pairs whose account rejected the optional request
# features (beta headers, server-side fallbacks, thinking display/binding)
# but accepted the plain request. Requests for them skip those features.
_COMPAT_ONLY: set[tuple[int, str]] = set()


def uses_compat_request(api_key: str, model: str) -> bool:
    return (hash(api_key), model) in _COMPAT_ONLY


def remember_compat_request(api_key: str, model: str) -> None:
    _COMPAT_ONLY.add((hash(api_key), model))
