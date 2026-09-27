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
  // Called with the in-progress partial line as tokens stream in (word by word),
  // and with null when there is no partial (the line just committed via onTurn or
  // the turn ended). Lets the renderer show text growing live before it commits.
  onStream?: (partial: PlanTurn | null) => void;
  // Called true when a turn starts generating and false when it completes, so the
  // renderer can show a thinking indicator and lock the reply box while an amigo
  // is replying. A session is idle (not busy) between turns and stays alive.
  onBusy?: (busy: boolean) => void;
  // Called exactly once when the SESSION ends terminally — a hard failure
  // (non-zero exit or spawn error) or an explicit stop(). A turn finishing
  // cleanly does NOT end the session: the runner keeps it alive for the next
  // send (each turn is one `kiro-cli --resume` run). Terminal: no turns follow.
  onExit?: () => void;
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
