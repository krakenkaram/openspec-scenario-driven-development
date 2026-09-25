import type { PlanTurn } from "../shared/ipc-contract";

// The one new seam PLAN introduces. An AgentRunner runs a tentacles skill in a
// folder and streams its turns back. Production spawns the kiro CLI's chat and
// parses its output (slice 9); tests inject a fake that emits scripted turns, so
// the whole feature is verified without a real agent. This mirrors how core.ts
// shells out to real CLIs in production but is unit-tested with fakes.

export interface StartSessionOptions {
  // The skill the agent loads, e.g. "tentacles-refinement". The agent itself
  // decides whether to bootstrap docs first; the app never switches skills.
  skill: string;
  // The folder the user picked; the agent runs here and writes .tentacles/* in place.
  folderPath: string;
  // The user's first idea, sent as the opening turn.
  firstMessage: string;
  // Called for each turn the agent produces, in arrival order.
  onTurn: (turn: PlanTurn) => void;
}

export interface AgentSession {
  // Relay a user turn to the running agent.
  send(text: string): void;
  // End the session and terminate the underlying agent.
  stop(): void;
}

export interface AgentRunner {
  start(options: StartSessionOptions): AgentSession;
}
