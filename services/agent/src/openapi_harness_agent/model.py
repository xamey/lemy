from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel

from .settings import Settings


def build_chat_model(settings: Settings) -> BaseChatModel:
    provider = "openai" if settings.llm_provider == "openai-compatible" else settings.llm_provider
    options = {
        "model": settings.llm_model,
        "model_provider": provider,
        "api_key": settings.llm_api_key,
    }
    if settings.llm_base_url:
        options["base_url"] = settings.llm_base_url
    return init_chat_model(**options)
