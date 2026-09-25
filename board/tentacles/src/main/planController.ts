import fs from "node:fs";
import path from "node:path";
import { containedRealPath } from "./core";
import type { AgentRunner, AgentSession } from "./agentRunner";
import type { ChooseDirectory, OpenPath, PlanController } from "./wiring";
import type {
  ChooseDirectoryResult,
  NewRefinementResult,
  OpenPathResult,
  PlanTurn,
  SendPlanTurnResult,
  StartPlanSessionArgs,
  StartPlanSessionResult,
} from "../shared/ipc-contract";

const REFINEMENT_SKILL = "tentacles-refinement";
const TICKET_REL = path.join(".tentacles", "TICKET.html");

// The instruction the app hands the one hosted agent. It carries the whole
// conduit contract in a single opening turn: the agent (not the app) checks for
// docs, delegates to tentacles-documentation when they are missing and runs that
// review loop, then refines the idea with tentacles-refinement. The app never
// referees the flow — it composes this once and relays every turn.
export function composeOpeningPrompt(idea: string): string {
  return [
    "You are refining a change for the project folder you are running in.",
    "",
    "First, check whether `.tentacles/TENTACLES.md` exists in this folder:",
    "- If it does NOT exist, load the `$tentacles-documentation` skill and use it to create `.tentacles/TENTACLES.md` and its component docs, running its full review loop until I approve the docs. Only then continue.",
    "- If it already exists, skip documentation and continue straight to refinement.",
    "",
    "Then load the `$tentacles-refinement` skill and refine this idea into a ticket, keeping every persona line prefixed (`**BA:**`, `**Dev:**`, `**QA:**`):",
    "",
    idea,
  ].join("\n");
}

export function makePlanController(
  runner: AgentRunner,
  pushTurn: (turn: PlanTurn) => void,
  pushStream: (partial: PlanTurn | null) => void,
  pushEnded: () => void,
  pushBusy: (busy: boolean) => void,
  chooseDirectory: ChooseDirectory,
  openPath: OpenPath
): PlanController {
  let session: AgentSession | null = null;
  let selectedFolder: string | null = null;
  // Monotonic id identifying the live session. Callbacks captured for a session
  // whose id is no longer current are dropped, so a dying process cannot leak a
  // late turn into a session that replaced it.
  let counter = 0;
  let currentId = 0;

  function stopCurrent(): void {
    // Invalidate the session id BEFORE stopping, so a runner that fires onExit
    // synchronously from stop() is seen as stale and cannot push a spurious
    // planSessionEnded (design D7).
    const handle = session;
    session = null;
    currentId = 0;
    handle?.stop();
  }

  return {
    async chooseFolder(): Promise<ChooseDirectoryResult> {
      const picked = await chooseDirectory();
      if (!picked) return { path: null };
      // Canonicalise the picked path once, here, so every later privileged use
      // works from the resolved path rather than a symlink or `..`-laden input.
      let canonical: string;
      try {
        canonical = fs.realpathSync(picked);
      } catch {
        canonical = path.resolve(picked);
      }
      selectedFolder = canonical;
      return { path: canonical };
    },

    async startSession({ idea }: StartPlanSessionArgs): Promise<StartPlanSessionResult> {
      if (!selectedFolder) return { ok: false, error: "no folder chosen" };
      // Stop any prior session before replacing it, so two agents never run.
      stopCurrent();
      const id = ++counter;
      currentId = id;
      session = runner.start({
        skill: REFINEMENT_SKILL,
        folderPath: selectedFolder,
        firstMessage: composeOpeningPrompt(idea),
        onTurn: (turn) => {
          if (id === currentId) pushTurn(turn);
        },
        onStream: (partial) => {
          if (id === currentId) pushStream(partial);
        },
        onBusy: (busy) => {
          if (id === currentId) pushBusy(busy);
        },
        onExit: () => {
          if (id !== currentId) return;
          session = null;
          currentId = 0;
          pushEnded();
        },
      });
      return { ok: true };
    },

    async sendTurn(text: string): Promise<SendPlanTurnResult> {
      if (!session) return { ok: false, error: "no active session" };
      session.send(text);
      return { ok: true };
    },

    async openTicket(): Promise<OpenPathResult> {
      if (!selectedFolder) return { ok: false, error: "no folder chosen" };
      const ticket = containedRealPath(selectedFolder, TICKET_REL);
      if (!ticket) return { ok: false, error: "ticket path outside folder" };
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(ticket);
      } catch {
        return { ok: false, error: "no ticket yet" };
      }
      if (!stat.isFile()) return { ok: false, error: "not a file" };
      const error = await openPath(ticket);
      return error ? { ok: false, error } : { ok: true };
    },

    async newRefinement(): Promise<NewRefinementResult> {
      stopCurrent();
      const folder = selectedFolder;
      selectedFolder = null;
      if (!folder) return { ok: true };
      // Containment-guard the PARENT `.tentacles` (design D5) so an escaping
      // symlink cannot redirect the delete outside the folder. Then remove the
      // LITERAL TICKET.html entry without following it: rmSync on a symlink
      // unlinks the link itself, so a ticket that is a symlink to an in-folder
      // doc loses only its link — never the doc it points at.
      const tentaclesDir = containedRealPath(folder, ".tentacles");
      if (!tentaclesDir) return { ok: false, error: "tentacles path outside folder" };
      const ticket = path.join(tentaclesDir, "TICKET.html");
      try {
        if (fs.lstatSync(ticket, { throwIfNoEntry: false })) fs.rmSync(ticket);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      return { ok: true };
    },

    shutdown(): void {
      stopCurrent();
      selectedFolder = null;
    },
  };
}
