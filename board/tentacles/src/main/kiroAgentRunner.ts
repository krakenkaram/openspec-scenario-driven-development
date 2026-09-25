import { spawn } from "node:child_process";
import type { AgentRunner, StartSessionOptions } from "./agentRunner";
import type { PlanSpeaker, PlanTurn } from "../shared/ipc-contract";

// The tentacles-refinement skill prefixes each amigo's line with its persona in
// bold. Parse that into a speaker; anything else is unattributed `system` output
// (never dropped, so the chat shows everything even if a prefix changes).
const PERSONA = /^\*\*(BA|Dev|QA):\*\*\s?(.*)$/;

export function attributeLine(line: string): PlanTurn {
  const m = line.match(PERSONA);
  if (m) return { speaker: m[1] as PlanSpeaker, text: m[2] ?? "" };
  return { speaker: "system", text: line };
}

// A child process reduced to what the runner drives, so tests inject a fake.
export interface ChildLike {
  stdout: { on(event: "data", cb: (chunk: string) => void): void };
  stdin: { write(data: string): void };
  on(event: "exit", cb: (code: number | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  kill(): void;
}

export type SpawnAgent = (folderPath: string, skill: string) => ChildLike;

// Production spawn: run the kiro CLI's interactive chat in the picked folder. The
// skill is installed under ~/.kiro/skills, so it is reached by naming it in the
// first message. Exact invocation is validated by the manual smoke (slice 9.4).
export function spawnKiroChat(folderPath: string, _skill: string): ChildLike {
  const child = spawn("kiro-cli", ["chat"], { cwd: folderPath });
  return child as unknown as ChildLike;
}

export function makeKiroAgentRunner(spawnAgent: SpawnAgent = spawnKiroChat): AgentRunner {
  return {
    start({ skill, folderPath, firstMessage, onTurn, onExit }: StartSessionOptions) {
      const child = spawnAgent(folderPath, skill);
      let buffer = "";
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        onExit?.();
      };

      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim().length > 0) onTurn(attributeLine(line));
        }
      });

      child.on("error", (err) => {
        onTurn({ speaker: "error", text: err?.message ?? String(err) });
        end();
      });

      child.on("exit", (code) => {
        if (buffer.trim().length > 0) {
          onTurn(attributeLine(buffer));
          buffer = "";
        }
        if (code != null && code !== 0) onTurn({ speaker: "error", text: `agent exited with code ${code}` });
        end();
      });

      // The opening message is composed by the controller (it carries the docs
      // bootstrap + refinement contract and the `$`-skill triggers), so it is
      // written verbatim rather than re-wrapped here.
      child.stdin.write(firstMessage.endsWith("\n") ? firstMessage : `${firstMessage}\n`);

      return {
        send: (text: string) => child.stdin.write(`${text}\n`),
        stop: () => child.kill(),
      };
    },
  };
}
