import { spawn } from "node:child_process";
import type { AgentRunner, StartSessionOptions } from "./agentRunner";
import type { PlanSpeaker, PlanTurn } from "../shared/ipc-contract";

// The tentacles-refinement skill prefixes each amigo's line with its persona in
// bold — `**BA:** …`. Real model output wraps that: a list marker, a block quote,
// a heading, leading whitespace, or the colon placed outside the bold (`**BA**:`).
// Match all of those. A line with no persona prefix is `system`; callers keep such
// a line under whichever persona is currently speaking, so a persona's wrapped or
// continuation lines are not stranded as system output.
const PERSONA = /^\s*(?:[-*+>]\s+|\d+[.)]\s+|#{1,6}\s+)?\*\*\s*(BA|Dev|QA)\s*:?\s*\*\*\s*:?\s*(.*)$/;

// The same persona marker, matched anywhere it is glued to preceding content on a
// line (no newline before it). Real model output often runs narration straight
// into the first question — `…implementation-ready.**BA:** Are you…`. A capture of
// the char before the marker lets us insert a line break so the narration and the
// persona line commit separately instead of as one blob. Horizontal-whitespace-only
// between the two keeps existing newline-separated lines untouched.
const INLINE_PERSONA_SPLIT = /(\S)[^\S\r\n]*(\*\*\s*(?:BA|Dev|QA)\s*:?\s*\*\*)/g;

export function attributeLine(line: string): PlanTurn {
  const m = line.match(PERSONA);
  if (m) return { speaker: m[1] as PlanSpeaker, text: m[2] ?? "" };
  return { speaker: "system", text: line };
}

// Pull the assistant text out of one stream-json (ACP) event line, or null when
// the event carries no agent text (run/metadata/tool events are ignored).
export function agentTextOf(event: unknown): string | null {
  const e = event as {
    type?: string;
    data?: { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } };
  };
  const u = e?.data?.update;
  if (e?.type === "sessionUpdate" && u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") {
    return u.content.text ?? "";
  }
  return null;
}

// A child process reduced to what the runner drives, so tests inject a fake. The
// message is passed as a spawn argument (not stdin), so no stdin handle is needed.
export interface ChildLike {
  stdout: { on(event: "data", cb: (chunk: string) => void): void };
  on(event: "exit", cb: (code: number | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  kill(): void;
}

export interface SpawnTurnOptions {
  folderPath: string;
  message: string;
  // False for the opening turn, true for every following turn so the folder's
  // conversation is continued rather than a fresh one started.
  resume: boolean;
}

export type SpawnAgent = (opts: SpawnTurnOptions) => ChildLike;

// Production spawn: one non-interactive kiro run per turn, emitting stream-json —
// the run's ACP events as JSON Lines on stdout, one self-describing event per
// line. That gives clean, token-level `agent_message_chunk` deltas (word by word)
// rather than the interactive TUI (which needs a TTY and is unparseable over a
// pipe). --resume continues the folder's conversation so the amigos keep one
// shared transcript. --trust-all-tools lets the agent create the .tentacles docs
// and ticket without a confirmation prompt it could not answer non-interactively.
export function spawnKiroChat({ folderPath, message, resume }: SpawnTurnOptions): ChildLike {
  const args = ["chat", "--no-interactive", "--output-format", "stream-json", "--trust-all-tools"];
  if (resume) args.push("--resume");
  args.push(message);
  const child = spawn("kiro-cli", args, { cwd: folderPath, env: process.env });
  return child as unknown as ChildLike;
}

export function makeKiroAgentRunner(spawnAgent: SpawnAgent = spawnKiroChat): AgentRunner {
  return {
    start({ folderPath, firstMessage, onTurn, onStream, onBusy, onExit }: StartSessionOptions) {
      let ended = false;
      let active: ChildLike | null = null;

      const endSession = () => {
        if (ended) return;
        ended = true;
        active = null;
        onExit?.();
      };

      const runTurn = (message: string, resume: boolean) => {
        // Single-flight: refuse to start a turn while one is already in flight,
        // so a duplicate or hostile send can never spawn a second concurrent
        // process against the same resumed conversation. The renderer disables
        // its box while busy, but the renderer is untrusted — this is the guard
        // that actually holds.
        if (ended || active) return;
        onBusy?.(true);
        const child = spawnAgent({ folderPath, message, resume });
        active = child;
        let jsonBuf = ""; // outer: newline-delimited JSON records from stdout
        let lineBuf = ""; // inner: the chat line being assembled from agent text
        // The persona currently speaking. A prefixed line sets it; an unprefixed
        // line inherits it, so a persona's wrapped/continuation lines stay attributed
        // to that persona instead of being stranded as `system`. Reset per turn.
        let speaker: PlanSpeaker = "system";

        // Attribute a completed line, honouring the sticky speaker: a persona prefix
        // switches (and remembers) the speaker; an unprefixed line keeps the current one.
        const attributeSticky = (line: string): PlanTurn => {
          const a = attributeLine(line);
          if (a.speaker !== "system") {
            speaker = a.speaker;
            return a;
          }
          return { speaker, text: line };
        };

        const emitTurn = (turn: PlanTurn) => {
          if (!ended && child === active) onTurn(turn);
        };
        const pushPartial = () => {
          if (ended || child !== active) return;
          if (lineBuf.length === 0) {
            onStream?.(null);
            return;
          }
          const a = attributeLine(lineBuf);
          onStream?.(a.speaker !== "system" ? a : { speaker, text: lineBuf });
        };

        // Feed decoded agent text into the line assembler: complete lines commit
        // as turns; the trailing fragment streams live as the in-progress partial.
        const consumeText = (text: string) => {
          lineBuf += text;
          // A persona marker glued mid-line starts a new speaker: break before it
          // so the preceding narration commits as its own line.
          lineBuf = lineBuf.replace(INLINE_PERSONA_SPLIT, "$1\n$2");
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim().length > 0) emitTurn(attributeSticky(line));
          }
          pushPartial();
        };

        child.stdout.on("data", (chunk) => {
          if (ended || child !== active) return;
          jsonBuf += chunk.toString();
          const records = jsonBuf.split("\n");
          jsonBuf = records.pop() ?? "";
          for (const record of records) {
            const s = record.trim();
            if (s.length === 0) continue;
            let event: unknown;
            try {
              event = JSON.parse(s);
            } catch {
              continue; // ignore any non-JSON noise
            }
            const text = agentTextOf(event);
            if (text) consumeText(text);
          }
        });

        child.on("error", (err) => {
          if (ended || child !== active) return;
          emitTurn({ speaker: "error", text: err?.message ?? String(err) });
          endSession();
        });

        child.on("exit", (code) => {
          if (ended || child !== active) return;
          if (lineBuf.trim().length > 0) emitTurn(attributeSticky(lineBuf));
          lineBuf = "";
          onStream?.(null);
          if (code != null && code !== 0) {
            emitTurn({ speaker: "error", text: `agent exited with code ${code}` });
            endSession();
            return;
          }
          // Clean turn completion: free the slot and keep the session alive for
          // the next send.
          active = null;
          onBusy?.(false);
        });
      };

      runTurn(firstMessage, false);

      return {
        send: (text: string) => runTurn(text, true),
        stop: () => {
          active?.kill();
          endSession();
        },
      };
    },
  };
}
