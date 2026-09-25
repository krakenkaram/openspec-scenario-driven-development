import type { PlanTurn } from "../shared/ipc-contract";
import type { AgentRunner, StartSessionOptions } from "./agentRunner";

// Test-only fake AgentRunner (not a *.test.ts, so vitest never runs it as a
// suite). It records what the app drove and lets a test push scripted turns.

export interface FakeAgentSession {
  options: StartSessionOptions;
  sent: string[];
  stopped: boolean;
  // Push a turn to the app as if the agent produced it.
  emit(turn: PlanTurn): void;
  // Drive the live partial-line stream as if tokens were arriving.
  stream(partial: PlanTurn | null): void;
  // Drive the busy signal as if a turn started (true) or finished (false).
  busy(value: boolean): void;
  // Fire the terminal end signal as if the underlying agent exited.
  exit(): void;
  send(text: string): void;
  stop(): void;
}

export interface FakeAgentRunner extends AgentRunner {
  sessions: FakeAgentSession[];
  last(): FakeAgentSession | undefined;
}

export function makeFakeAgentRunner(opts: { failOnStart?: string; exitOnStop?: boolean } = {}): FakeAgentRunner {
  const sessions: FakeAgentSession[] = [];
  return {
    sessions,
    last: () => sessions[sessions.length - 1],
    start(options: StartSessionOptions) {
      const session: FakeAgentSession = {
        options,
        sent: [],
        stopped: false,
        emit: (turn) => options.onTurn(turn),
        stream: (partial) => options.onStream?.(partial),
        busy: (value) => options.onBusy?.(value),
        exit: () => options.onExit?.(),
        send: (text) => {
          session.sent.push(text);
        },
        stop: () => {
          session.stopped = true;
          // Model a runtime that reports its exit synchronously from stop().
          if (opts.exitOnStop) options.onExit?.();
        },
      };
      sessions.push(session);
      if (opts.failOnStart) options.onTurn({ speaker: "error", text: opts.failOnStart });
      return session;
    },
  };
}
