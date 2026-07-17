from openapi_harness_agent.auth import bearer_context, bearer_scope
from openapi_harness_agent.checkpointer import scoped_checkpoint_config, scoped_thread_id


def test_checkpoint_access_scopes_the_thread_and_preserves_subgraph_namespace():
    authorization = "Bearer api-token"

    with bearer_context(authorization):
        config = scoped_checkpoint_config(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "checkpoint_ns": "agent:subgraph",
                }
            }
        )

    assert config["configurable"] == {
        "thread_id": f"{bearer_scope(authorization)}:thread-1",
        "checkpoint_ns": "agent:subgraph",
    }


def test_thread_scoping_is_idempotent_and_differs_between_bearers():
    with bearer_context("Bearer first-token"):
        first = scoped_thread_id("thread-1")
        assert scoped_thread_id(first) == first

    with bearer_context("Bearer second-token"):
        second = scoped_thread_id("thread-1")

    assert first != second
