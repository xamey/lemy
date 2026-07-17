import type { AbstractAgent, BaseEvent, RunAgentInput, RunStartedEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { supportsLocalThreadEndpoints } from "@copilotkit/runtime/v2";
import { describe, expect, it } from "vitest";

import {
  BearerScopedAgentRunner,
  runWithBearerScope,
} from "../src/bearer-scoped-agent-runner.js";

function createRunningAgent(event: RunStartedEvent): {
  agent: AbstractAgent;
  abortCount: () => number;
} {
  let aborts = 0;
  let agent: AbstractAgent;
  const runAgent: AbstractAgent["runAgent"] = async (input, subscriber) => {
    await subscriber?.onEvent?.({
      agent,
      event,
      input: input as RunAgentInput,
      messages: [],
      state: {},
    });
    return new Promise<never>(() => undefined);
  };

  agent = {
    agentId: "default",
    messages: [],
    abortRun: () => {
      aborts += 1;
    },
    runAgent,
  } as unknown as AbstractAgent;

  return { agent, abortCount: () => aborts };
}

describe("BearerScopedAgentRunner", () => {
  it("isolates replay and cancellation for the same public thread ID", async () => {
    const runner = new BearerScopedAgentRunner();
    const threadId = `shared-thread-${crypto.randomUUID()}`;
    const runId = crypto.randomUUID();
    const input: RunAgentInput = {
      context: [],
      messages: [],
      runId,
      state: {},
      threadId,
      tools: [],
    };
    const event: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      runId,
      threadId,
    };
    const { agent, abortCount } = createRunningAgent(event);

    runWithBearerScope("bearer   first-user-token", () =>
      runner.run({ agent, input, threadId }),
    );

    const secondUserEvents: BaseEvent[] = [];
    let secondUserReplayCompleted = false;
    runWithBearerScope("Bearer second-user-token", () =>
      runner.connect({ threadId }),
    ).subscribe({
      next: (replayedEvent) => secondUserEvents.push(replayedEvent),
      complete: () => {
        secondUserReplayCompleted = true;
      },
    });

    expect(secondUserEvents).toEqual([]);
    expect(secondUserReplayCompleted).toBe(true);
    await expect(
      runWithBearerScope("Bearer second-user-token", () => runner.stop({ threadId })),
    ).resolves.toBe(false);
    expect(abortCount()).toBe(0);
    await expect(
      runWithBearerScope("Bearer first-user-token", () => runner.isRunning({ threadId })),
    ).resolves.toBe(true);

    const firstUserEvents: BaseEvent[] = [];
    runWithBearerScope("Bearer first-user-token", () =>
      runner.connect({ threadId }),
    ).subscribe((replayedEvent) => firstUserEvents.push(replayedEvent));

    expect(firstUserEvents).toContainEqual(expect.objectContaining(event));
    await expect(
      runWithBearerScope("Bearer first-user-token", () => runner.stop({ threadId })),
    ).resolves.toBe(true);
    expect(abortCount()).toBe(1);
  });

  it("does not advertise the unscoped local thread history endpoints", () => {
    expect(supportsLocalThreadEndpoints(new BearerScopedAgentRunner())).toBe(false);
  });
});
