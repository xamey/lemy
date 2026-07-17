from collections.abc import Mapping
from dataclasses import dataclass
from os import environ
from urllib.parse import quote, urlsplit

DEFAULT_SYSTEM_PROMPT = """You operate the user's API through Code Mode MCP tools.
Use search to discover the exact OpenAPI operation before execute. Never invent paths or
parameters. Prefer focused results. The bearer credential is enforced outside model context.
Mutations may be blocked by server policy; if enabled, confirm the user's intent first."""
SUPPORTED_LLM_PROVIDERS = {"anthropic", "openai", "openai-compatible"}


def required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


@dataclass(frozen=True)
class Settings:
    llm_provider: str
    llm_api_key: str
    llm_model: str
    llm_base_url: str | None
    mcp_url: str
    system_prompt: str
    database_url: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] = environ) -> "Settings":
        llm_provider = env.get("LLM_PROVIDER", "openai").strip().lower() or "openai"
        if llm_provider not in SUPPORTED_LLM_PROVIDERS:
            supported = ", ".join(sorted(SUPPORTED_LLM_PROVIDERS))
            raise ValueError(f"LLM_PROVIDER must be one of: {supported}")

        llm_base_url = env.get("LLM_BASE_URL", "").strip() or None
        if llm_provider == "openai-compatible" and not llm_base_url:
            raise ValueError("LLM_BASE_URL is required for openai-compatible")
        if llm_provider != "openai-compatible" and llm_base_url:
            raise ValueError("LLM_BASE_URL is only supported for openai-compatible")
        if llm_base_url:
            parsed_base_url = urlsplit(llm_base_url)
            if parsed_base_url.scheme not in {"http", "https"} or not parsed_base_url.netloc:
                raise ValueError("LLM_BASE_URL must be an HTTP or HTTPS URL")

        database_url = env.get("DATABASE_URL", "").strip()
        if not database_url:
            user = quote(env.get("POSTGRES_USER", "postgres"), safe="")
            password = quote(required(env, "POSTGRES_PASSWORD"), safe="")
            host = env.get("POSTGRES_HOST", "postgres").strip() or "postgres"
            database = quote(env.get("POSTGRES_DB", "harness"), safe="")
            port = int(env.get("POSTGRES_PORT", "5432"))
            if port < 1 or port > 65_535:
                raise ValueError("POSTGRES_PORT must be a valid TCP port")
            database_url = f"postgresql://{user}:{password}@{host}:{port}/{database}"

        return cls(
            llm_provider=llm_provider,
            llm_api_key=required(env, "LLM_API_KEY"),
            llm_model=env.get("LLM_MODEL", "gpt-5-mini").strip() or "gpt-5-mini",
            llm_base_url=llm_base_url,
            mcp_url=env.get("MCP_URL", "http://codemode:8787/mcp").strip(),
            system_prompt=env.get("SYSTEM_PROMPT", "").strip() or DEFAULT_SYSTEM_PROMPT,
            database_url=database_url,
        )
