import pytest

from openapi_harness_agent.auth import bearer_scope, require_bearer


def test_require_bearer_preserves_the_credential():
    assert require_bearer("Bearer api-token") == "Bearer api-token"


@pytest.mark.parametrize("value", [None, "", "Basic api-token", "Bearer "])
def test_require_bearer_rejects_missing_or_malformed_credentials(value):
    with pytest.raises(ValueError, match="Bearer"):
        require_bearer(value)


def test_bearer_scope_is_stable_without_containing_the_token():
    namespace = bearer_scope("Bearer api-token")

    assert namespace == bearer_scope("bearer api-token")
    assert "api-token" not in namespace
    assert len(namespace) == 64
