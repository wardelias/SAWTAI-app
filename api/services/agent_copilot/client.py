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


def api_error_message(e: anthropic.APIError) -> str:
    if isinstance(e, anthropic.AuthenticationError):
        return "The assistant is misconfigured (invalid Anthropic API key)."
    if isinstance(e, anthropic.RateLimitError):
        return "The assistant is busy right now. Please try again in a minute."
    if isinstance(e, anthropic.APIConnectionError):
        return "Couldn't reach the AI service. Please try again."
    return "The assistant hit an error. Please try again."
