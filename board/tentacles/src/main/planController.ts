import fs from "node:fs";
import path from "node:path";
import type { AgentRunner, AgentSession } from "./agentRunner";
import type { PlanController } from "./wiring";
import type {
  NewRefinementResult,
  PlanTurn,
  SendPlanTurnResult,
  StartPlanSessionArgs,
  StartPlanSessionResult,
} from "../shared/ipc-contract";

const REFINEMENT_SKILL = "tentacles-refinement";

export function makePlanController(runner: AgentRunner, pushTurn: (turn: PlanTurn) => void): PlanController {
  let session: AgentSession | null = null;

  return {
    async startSession({ folderPath, idea }: StartPlanSessionArgs): Promise<StartPlanSessionResult> {
      if (!folderPath) return { ok: false, error: "no folder chosen" };
      session = runner.start({ skill: REFINEMENT_SKILL, folderPath, firstMessage: idea, onTurn: pushTurn });
      return { ok: true };
    },

    async sendTurn(text: string): Promise<SendPlanTurnResult> {
      if (!session) return { ok: false, error: "no active session" };
      session.send(text);
      return { ok: true };
    },

    async newRefinement(folderPath: string): Promise<NewRefinementResult> {
      session?.stop();
      session = null;
      try {
        const ticket = path.join(folderPath, ".tentacles", "TICKET.html");
        if (fs.existsSync(ticket)) fs.rmSync(ticket);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      return { ok: true };
    },
  };
}
