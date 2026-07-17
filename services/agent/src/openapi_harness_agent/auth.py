from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256

_authorization: ContextVar[str | None] = ContextVar("authorization", default=None)


def require_bearer(authorization: str | None) -> str:
    if not authorization:
        raise ValueError("Bearer token required")

    scheme, separator, token = authorization.strip().partition(" ")
    if scheme.lower() != "bearer" or not separator or not token.strip():
        raise ValueError("Bearer token required")
    return authorization.strip()


def bearer_scope(authorization: str) -> str:
    token = require_bearer(authorization).split(None, 1)[1]
    return sha256(token.encode()).hexdigest()


@contextmanager
def bearer_context(authorization: str) -> Iterator[None]:
    reset_token = _authorization.set(require_bearer(authorization))
    try:
        yield
    finally:
        _authorization.reset(reset_token)


def current_bearer() -> str:
    return require_bearer(_authorization.get())
