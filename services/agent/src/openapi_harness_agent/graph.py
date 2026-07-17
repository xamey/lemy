from collections.abc import Callable
from typing import Any

from langchain.agents import create_agent
from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.graph import END, START, MessagesState, StateGraph

from .auth import current_bearer, require_bearer
from .model import build_chat_model
from .settings import Settings


def build_mcp_connections(mcp_url: str, authorization: str) -> dict[str, Any]:
    return {
        "openapi": {
            "transport": "streamable_http",
            "url": mcp_url,
            "headers": {"Authorization": require_bearer(authorization)},
        }
    }


def child_config(config: RunnableConfig) -> RunnableConfig:
    allowed = ("callbacks", "tags", "metadata", "run_name", "recursion_limit")
    return {key: config[key] for key in allowed if key in config}  # type: ignore[typeddict-item]


async def run_turn(
    state: MessagesState,
    config: RunnableConfig,
    *,
    model: Any,
    settings: Settings,
    mcp_client_factory: Callable[..., Any] = MultiServerMCPClient,
    agent_factory: Callable[..., Any] = create_agent,
) -> dict[str, list[Any]]:
    authorization = current_bearer()
    client = mcp_client_factory(build_mcp_connections(settings.mcp_url, authorization))
    tools = await client.get_tools()
    agent = agent_factory(model=model, tools=tools, system_prompt=settings.system_prompt)

    messages = state["messages"]
    response = await agent.ainvoke({"messages": messages}, child_config(config))
    return {"messages": response["messages"][len(messages) :]}


def build_workflow(settings: Settings) -> StateGraph:
    model = build_chat_model(settings)
    workflow = StateGraph(MessagesState)

    async def agent_node(state: MessagesState, config: RunnableConfig):
        return await run_turn(state, config, model=model, settings=settings)

    workflow.add_node("agent", agent_node)
    workflow.add_edge(START, "agent")
    workflow.add_edge("agent", END)
    return workflow
