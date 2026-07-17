import pytest

from openapi_harness_agent.settings import Settings


def test_settings_build_a_safe_postgres_url_from_credentials():
    settings = Settings.from_env(
        {
            "LLM_API_KEY": "llm-key",
            "POSTGRES_USER": "api user",
            "POSTGRES_PASSWORD": "p@ss/word",
            "POSTGRES_DB": "agent db",
            "POSTGRES_HOST": "database",
            "POSTGRES_PORT": "5433",
        }
    )

    assert settings.database_url == (
        "postgresql://api%20user:p%40ss%2Fword@database:5433/agent%20db"
    )


def test_database_url_override_wins():
    settings = Settings.from_env(
        {
            "LLM_API_KEY": "llm-key",
            "DATABASE_URL": "postgresql://custom/database",
        }
    )

    assert settings.database_url == "postgresql://custom/database"


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_native_model_providers(provider):
    settings = Settings.from_env(
        {
            "DATABASE_URL": "postgresql://custom/database",
            "LLM_API_KEY": "llm-key",
            "LLM_MODEL": "model-name",
            "LLM_PROVIDER": provider,
        }
    )

    assert settings.llm_provider == provider
    assert settings.llm_base_url is None


def test_openai_compatible_requires_a_base_url():
    with pytest.raises(ValueError, match="LLM_BASE_URL"):
        Settings.from_env(
            {
                "DATABASE_URL": "postgresql://custom/database",
                "LLM_API_KEY": "llm-key",
                "LLM_PROVIDER": "openai-compatible",
            }
        )


def test_openai_compatible_keeps_its_base_url():
    settings = Settings.from_env(
        {
            "DATABASE_URL": "postgresql://custom/database",
            "LLM_API_KEY": "llm-key",
            "LLM_PROVIDER": "openai-compatible",
            "LLM_BASE_URL": "http://models.test/v1",
        }
    )

    assert settings.llm_base_url == "http://models.test/v1"


def test_model_base_url_must_be_http():
    with pytest.raises(ValueError, match="HTTP"):
        Settings.from_env(
            {
                "DATABASE_URL": "postgresql://custom/database",
                "LLM_API_KEY": "llm-key",
                "LLM_PROVIDER": "openai-compatible",
                "LLM_BASE_URL": "file:///models",
            }
        )


def test_native_provider_rejects_a_custom_base_url():
    with pytest.raises(ValueError, match="only supported"):
        Settings.from_env(
            {
                "DATABASE_URL": "postgresql://custom/database",
                "LLM_API_KEY": "llm-key",
                "LLM_PROVIDER": "anthropic",
                "LLM_BASE_URL": "https://models.test",
            }
        )


def test_unknown_model_provider_is_rejected():
    with pytest.raises(ValueError, match="LLM_PROVIDER"):
        Settings.from_env(
            {
                "DATABASE_URL": "postgresql://custom/database",
                "LLM_API_KEY": "llm-key",
                "LLM_PROVIDER": "unknown",
            }
        )
