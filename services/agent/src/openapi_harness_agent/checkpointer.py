from collections.abc import AsyncIterator, Mapping, Sequence
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    DeltaChannelHistory,
)
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from .auth import bearer_scope, current_bearer


def scoped_thread_id(thread_id: str) -> str:
    scope = bearer_scope(current_bearer())
    prefix = f"{scope}:"
    return thread_id if thread_id.startswith(prefix) else f"{prefix}{thread_id}"


def scoped_checkpoint_config(config: RunnableConfig | None) -> RunnableConfig:
    if config is None:
        raise ValueError("Checkpoint access requires a thread config")

    configurable = dict(config.get("configurable", {}))
    thread_id = configurable.get("thread_id")
    if not isinstance(thread_id, str) or not thread_id:
        raise ValueError("Checkpoint access requires a thread ID")
    configurable["thread_id"] = scoped_thread_id(thread_id)
    return {**config, "configurable": configurable}  # type: ignore[return-value]


class ScopedAsyncPostgresSaver(AsyncPostgresSaver):
    async def alist(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        async for checkpoint in super().alist(
            scoped_checkpoint_config(config),
            filter=filter,
            before=scoped_checkpoint_config(before) if before else None,
            limit=limit,
        ):
            yield checkpoint

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        return await super().aget_tuple(scoped_checkpoint_config(config))

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        return await super().aput(
            scoped_checkpoint_config(config), checkpoint, metadata, new_versions
        )

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        await super().aput_writes(scoped_checkpoint_config(config), writes, task_id, task_path)

    async def adelete_thread(self, thread_id: str) -> None:
        await super().adelete_thread(scoped_thread_id(thread_id))

    async def aget_delta_channel_history(
        self,
        *,
        config: RunnableConfig,
        channels: Sequence[str],
    ) -> Mapping[str, DeltaChannelHistory]:
        return await super().aget_delta_channel_history(
            config=scoped_checkpoint_config(config), channels=channels
        )
