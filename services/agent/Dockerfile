FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
COPY services/agent/pyproject.toml services/agent/uv.lock ./
COPY services/agent/src src
RUN uv sync --frozen --no-dev

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "openapi_harness_agent.main:app", "--host", "0.0.0.0", "--port", "8000"]
