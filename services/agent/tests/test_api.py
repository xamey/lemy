from fastapi import FastAPI
from fastapi.testclient import TestClient

from openapi_harness_agent.api import register_agent_endpoint
from openapi_harness_agent.auth import current_bearer

RUN_INPUT = {
    "threadId": "thread-1",
    "runId": "run-1",
    "state": {},
    "messages": [],
    "tools": [],
    "context": [],
    "forwardedProps": {},
}


def test_agent_endpoint_requires_a_bearer():
    app = FastAPI()
    register_agent_endpoint(app)

    response = TestClient(app).post("/agent", json=RUN_INPUT)

    assert response.status_code == 401


def test_agent_endpoint_keeps_auth_out_of_checkpoint_config():
    captured = {}

    class FakeAgent:
        async def run(self, _input):
            captured["authorization"] = current_bearer()
            if False:
                yield None

    def fake_agent_factory(**kwargs):
        captured.update(kwargs)
        return FakeAgent()

    app = FastAPI()
    app.state.graph = object()
    register_agent_endpoint(app, agent_factory=fake_agent_factory)

    response = TestClient(app).post(
        "/agent",
        json=RUN_INPUT,
        headers={"Authorization": "Bearer api-token"},
    )

    assert response.status_code == 200
    assert "config" not in captured
    assert captured["authorization"] == "Bearer api-token"


def test_agent_endpoint_streams_a_sanitized_run_error():
    class FakeAgent:
        async def run(self, _input):
            raise RuntimeError("secret upstream detail")
            yield

    app = FastAPI()
    app.state.graph = object()
    register_agent_endpoint(app, agent_factory=lambda **_kwargs: FakeAgent())

    response = TestClient(app).post(
        "/agent",
        json=RUN_INPUT,
        headers={"Authorization": "Bearer api-token"},
    )

    assert response.status_code == 200
    assert "RUN_ERROR" in response.text
    assert "AGENT_RUN_FAILED" in response.text
    assert "secret upstream detail" not in response.text
