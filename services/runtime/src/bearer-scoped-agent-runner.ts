import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import {
  AgentRunner,
  InMemoryAgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";

const bearerScopeStorage = new AsyncLocalStorage<string>();

export function runWithBearerScope<T>(authorization: string, callback: () => T): T {
  const credential = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!credential) throw new Error("Valid bearer authorization is required");
  const scope = createHash("sha256").update(credential).digest("hex");
  return bearerScopeStorage.run(scope, callback);
}

function scopedThreadId(threadId: string): string {
  const scope = bearerScopeStorage.getStore();
  if (!scope) throw new Error("Bearer scope is unavailable");
  return `${scope}:${threadId}`;
}

export class BearerScopedAgentRunner extends AgentRunner {
  private readonly delegate = new InMemoryAgentRunner();

  run(request: AgentRunnerRunRequest) {
    return this.delegate.run({ ...request, threadId: scopedThreadId(request.threadId) });
  }

  connect(request: AgentRunnerConnectRequest) {
    return this.delegate.connect({ ...request, threadId: scopedThreadId(request.threadId) });
  }

  isRunning(request: AgentRunnerIsRunningRequest) {
    return this.delegate.isRunning({ ...request, threadId: scopedThreadId(request.threadId) });
  }

  stop(request: AgentRunnerStopRequest) {
    return this.delegate.stop({ ...request, threadId: scopedThreadId(request.threadId) });
  }
}
