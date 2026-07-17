from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api import register_agent_endpoint
from .checkpointer import ScopedAsyncPostgresSaver
from .graph import build_workflow
from .settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    async with ScopedAsyncPostgresSaver.from_conn_string(settings.database_url) as checkpointer:
        await checkpointer.setup()
        app.state.graph = build_workflow(settings).compile(checkpointer=checkpointer)
        yield


app = FastAPI(
    title="Lemy",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "ok"}


register_agent_endpoint(app)
