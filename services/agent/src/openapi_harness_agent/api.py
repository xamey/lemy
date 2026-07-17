from collections.abc import Callable
from logging import getLogger
from typing import Any

from ag_ui.core import RunAgentInput, RunErrorEvent
from ag_ui.encoder import EventEncoder
from copilotkit import LangGraphAGUIAgent
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from .auth import bearer_context, require_bearer

logger = getLogger(__name__)


def register_agent_endpoint(
    app: FastAPI,
    path: str = "/agent",
    *,
    agent_factory: Callable[..., Any] = LangGraphAGUIAgent,
) -> None:
    @app.post(path)
    async def run_agent(input_data: RunAgentInput, request: Request):
        try:
            authorization = require_bearer(request.headers.get("authorization"))
        except ValueError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error

        encoder = EventEncoder(accept=request.headers.get("accept"))
        agent = agent_factory(
            name="default",
            description="Agent for the configured OpenAPI service",
            graph=request.app.state.graph,
        )

        async def events():
            with bearer_context(authorization):
                try:
                    async for event in agent.run(input_data):
                        yield encoder.encode(event)
                except Exception as error:
                    logger.error("Agent run failed (%s)", type(error).__name__)
                    yield encoder.encode(
                        RunErrorEvent(message="Agent run failed", code="AGENT_RUN_FAILED")
                    )

        return StreamingResponse(events(), media_type=encoder.get_content_type())
