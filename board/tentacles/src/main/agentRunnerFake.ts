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
  // Fire the terminal end signal as if the underlying agent exited.
  exit(): void;
  send(text: string): void;
  stop(): void;
}

export interface FakeAgentRunner extends AgentRunner {
  sessions: FakeAgentSession[];
  last(): FakeAgentSession | undefined;
}

export function makeFakeAgentRunner(opts: { failOnStart?: string } = {}): FakeAgentRunner {
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
        exit: () => options.onExit?.(),
        send: (text) => {
          session.sent.push(text);
        },
        stop: () => {
          session.stopped = true;
        },
      };
      sessions.push(session);
      if (opts.failOnStart) options.onTurn({ speaker: "error", text: opts.failOnStart });
      return session;
    },
  };
}
