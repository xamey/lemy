from langchain_core.messages import AIMessage, HumanMessage

from openapi_harness_agent.auth import bearer_context
from openapi_harness_agent.graph import build_mcp_connections, run_turn
from openapi_harness_agent.settings import Settings


def make_settings() -> Settings:
    return Settings(
        llm_provider="openai",
        llm_api_key="llm-key",
        llm_model="gpt-5-mini",
        llm_base_url=None,
        mcp_url="http://codemode.test/mcp",
        system_prompt="Use the API.",
        database_url="postgresql://database",
    )


def test_build_mcp_connections_forwards_only_the_bearer():
    assert build_mcp_connections("http://codemode.test/mcp", "Bearer api-token") == {
        "openapi": {
            "transport": "streamable_http",
            "url": "http://codemode.test/mcp",
            "headers": {"Authorization": "Bearer api-token"},
        }
    }


async def test_run_turn_loads_mcp_tools_and_returns_only_new_messages():
    captured = {}

    class FakeMcpClient:
        def __init__(self, connections):
            captured["connections"] = connections

        async def get_tools(self):
            return ["search", "execute"]

    class FakeAgent:
        async def ainvoke(self, state, config):
            captured["state"] = state
            captured["config"] = config
            return {"messages": [*state["messages"], AIMessage(content="done")]}

    def fake_agent_factory(model, tools, system_prompt):
        captured.update(model=model, tools=tools, system_prompt=system_prompt)
        return FakeAgent()

    history = [HumanMessage(content="List my pets")]
    with bearer_context("Bearer api-token"):
        result = await run_turn(
            {"messages": history},
            {"configurable": {}},
            model=object(),
            settings=make_settings(),
            mcp_client_factory=FakeMcpClient,
            agent_factory=fake_agent_factory,
        )

    assert result["messages"][0].content == "done"
    assert captured["connections"]["openapi"]["headers"] == {"Authorization": "Bearer api-token"}
    assert captured["state"] == {"messages": history}
    assert "authorization" not in captured["config"].get("configurable", {})
