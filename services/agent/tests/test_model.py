from unittest.mock import patch

import pytest

from openapi_harness_agent.model import build_chat_model
from openapi_harness_agent.settings import Settings


def make_settings(provider: str, base_url: str | None = None) -> Settings:
    return Settings(
        llm_provider=provider,
        llm_api_key="llm-key",
        llm_model="model-name",
        llm_base_url=base_url,
        mcp_url="http://codemode.test/mcp",
        system_prompt="Use the API.",
        database_url="postgresql://database",
    )


def test_builds_native_openai_and_anthropic_models():
    with patch("openapi_harness_agent.model.init_chat_model") as init_model:
        build_chat_model(make_settings("openai"))
        build_chat_model(make_settings("anthropic"))

    assert init_model.call_args_list[0].kwargs == {
        "api_key": "llm-key",
        "model": "model-name",
        "model_provider": "openai",
    }
    assert init_model.call_args_list[1].kwargs == {
        "api_key": "llm-key",
        "model": "model-name",
        "model_provider": "anthropic",
    }


def test_builds_an_openai_compatible_model_with_its_base_url():
    with patch("openapi_harness_agent.model.init_chat_model") as init_model:
        build_chat_model(make_settings("openai-compatible", "http://models.test/v1"))

    assert init_model.call_args.kwargs == {
        "api_key": "llm-key",
        "base_url": "http://models.test/v1",
        "model": "model-name",
        "model_provider": "openai",
    }


@pytest.mark.parametrize(
    ("provider", "expected_type"),
    [("openai", "ChatOpenAI"), ("anthropic", "ChatAnthropic")],
)
def test_provider_integrations_are_installed(provider, expected_type):
    assert type(build_chat_model(make_settings(provider))).__name__ == expected_type
