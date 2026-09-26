import { describe, it, expect } from "vitest";
import { attributeLine, agentTextOf, makeKiroAgentRunner, type ChildLike, type SpawnTurnOptions } from "./kiroAgentRunner";
import type { PlanTurn } from "../shared/ipc-contract";

// Build one stream-json event line carrying an agent text chunk.
function chunk(text: string): string {
  return JSON.stringify({
    type: "sessionUpdate",
    data: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  });
}

// One fake child per spawned turn. Records the spawn options and lets a test
// drive that child's stdout/exit/error.
function makeFakeChild(opts: SpawnTurnOptions) {
  let dataCb: (chunk: string) => void = () => {};
  let exitCb: (code: number | null) => void = () => {};
  let errorCb: (e: Error) => void = () => {};
  let killed = false;
  const child: ChildLike = {
    stdout: { on: (_e, cb) => (dataCb = cb) },
    on: (e, cb) => {
      if (e === "exit") exitCb = cb as (code: number | null) => void;
      if (e === "error") errorCb = cb as (e: Error) => void;
    },
    kill: () => {
      killed = true;
    },
  };
  return {
    child,
    opts,
    emitStdout: (s: string) => dataCb(s),
    emitExit: (code: number | null) => exitCb(code),
    emitError: (e: Error) => errorCb(e),
    get killed() {
      return killed;
    },
  };
}

function fakeSpawner() {
  const spawned: ReturnType<typeof makeFakeChild>[] = [];
  const spawn = (opts: SpawnTurnOptions): ChildLike => {
    const fake = makeFakeChild(opts);
    spawned.push(fake);
    return fake.child;
  };
  return { spawn, spawned, last: () => spawned[spawned.length - 1] };
}

describe("attributeLine — persona prefixes → speakers", () => {
  it("maps **BA:/**Dev:/**QA:** to their speakers", () => {
    expect(attributeLine("**BA:** What problem does this solve?")).toEqual({ speaker: "BA", text: "What problem does this solve?" });
    expect(attributeLine("**Dev:** How is it built?")).toEqual({ speaker: "Dev", text: "How is it built?" });
    expect(attributeLine("**QA:** Any edge cases?")).toEqual({ speaker: "QA", text: "Any edge cases?" });
  });

  it("attributes unrecognised output to system rather than dropping it", () => {
    expect(attributeLine("Writing .tentacles/TICKET.html")).toEqual({ speaker: "system", text: "Writing .tentacles/TICKET.html" });
  });

  it("tolerates the wrapping real model output puts around a persona prefix", () => {
    // List markers, block quotes, headings, leading whitespace, and the colon
    // placed outside the bold are all common — none should demote a persona to system.
    expect(attributeLine("- **BA:** hello")).toEqual({ speaker: "BA", text: "hello" });
    expect(attributeLine("* **Dev:** hello")).toEqual({ speaker: "Dev", text: "hello" });
    expect(attributeLine("  > **QA:** hi")).toEqual({ speaker: "QA", text: "hi" });
    expect(attributeLine("**Dev**: colon outside the bold")).toEqual({ speaker: "Dev", text: "colon outside the bold" });
    expect(attributeLine("1. **BA:** numbered")).toEqual({ speaker: "BA", text: "numbered" });
  });
});

describe("agentTextOf — pulling agent text from stream-json events", () => {
  it("returns the text of an agent_message_chunk and null for anything else", () => {
    expect(agentTextOf(JSON.parse(chunk("hi")))).toBe("hi");
    expect(agentTextOf({ type: "runStarted", data: {} })).toBeNull();
    expect(agentTextOf({ type: "metadata", data: { sessionId: "x" } })).toBeNull();
  });
});

describe("makeKiroAgentRunner — one run per turn, stream-json", () => {
  it("opens with the first message, no resume, and requests stream-json output", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    runner.start({ skill: "tentacles-refinement", folderPath: "/proj", firstMessage: "add dark mode", onTurn: () => {} });
    expect(sp.last().opts).toEqual({ folderPath: "/proj", message: "add dark mode", resume: false });
  });

  it("streams token chunks as a growing partial, then commits the line as a turn on newline", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    const partials: (PlanTurn | null)[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t), onStream: (p) => partials.push(p) });

    // Word-by-word arrival within one event, and split across events.
    sp.last().emitStdout(chunk("**BA:** What") + "\n");
    sp.last().emitStdout(chunk(" problem") + "\n");
    // No newline yet — nothing committed, the partial has grown.
    expect(turns).toEqual([]);
    expect(partials).toEqual([
      { speaker: "BA", text: "What" },
      { speaker: "BA", text: "What problem" },
    ]);

    // The newline commits the line as a turn and clears the partial.
    sp.last().emitStdout(chunk("?\n") + "\n");
    expect(turns).toEqual([{ speaker: "BA", text: "What problem?" }]);
    expect(partials[partials.length - 1]).toBeNull();
  });

  it("refuses a concurrent send while a turn is in flight, then allows one after it exits", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const session = runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: () => {} });
    expect(sp.spawned).toHaveLength(1);

    // A send arrives while the first turn's child has NOT exited — no second process.
    session.send("too soon");
    expect(sp.spawned).toHaveLength(1);

    // Once the in-flight turn exits cleanly, a send spawns the next (resumed) turn.
    sp.last().emitExit(0);
    session.send("now ok");
    expect(sp.spawned).toHaveLength(2);
    expect(sp.last().opts).toEqual({ folderPath: "/p", message: "now ok", resume: true });
  });

  it("keeps the session alive after a clean turn and resumes on send with stream-json", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const busy: boolean[] = [];
    let exits = 0;
    const session = runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: () => {}, onBusy: (b) => busy.push(b), onExit: () => (exits += 1) });

    sp.last().emitExit(0);
    expect(exits).toBe(0);
    expect(busy).toEqual([true, false]);

    session.send("my answer");
    expect(sp.last().opts).toEqual({ folderPath: "/p", message: "my answer", resume: true });
    expect(busy).toEqual([true, false, true]);
  });

  it("commits a trailing partial line on clean exit and clears the stream", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    const partials: (PlanTurn | null)[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t), onStream: (p) => partials.push(p) });

    sp.last().emitStdout(chunk("**Dev:** final thought") + "\n");
    sp.last().emitExit(0);
    expect(turns).toEqual([{ speaker: "Dev", text: "final thought" }]);
    expect(partials[partials.length - 1]).toBeNull();
  });

  it("splits a persona marker glued mid-line onto the previous sentence into its own speaker", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    const partials: (PlanTurn | null)[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t), onStream: (p) => partials.push(p) });

    // The whole opening reply arrives with NO newline before the persona marker —
    // agent narration glued directly to the first question (the real model output).
    sp.last().emitStdout(chunk("Skipping documentation generation.**BA:** Are you a developer?") + "\n");

    // The narration commits as its own system turn; the BA question is separate.
    expect(turns).toEqual([{ speaker: "system", text: "Skipping documentation generation." }]);
    expect(partials[partials.length - 1]).toEqual({ speaker: "BA", text: "Are you a developer?" });

    // On exit the trailing BA line commits — never merged into the narration.
    sp.last().emitExit(0);
    expect(turns).toEqual([
      { speaker: "system", text: "Skipping documentation generation." },
      { speaker: "BA", text: "Are you a developer?" },
    ]);
  });

  it("splits a mid-line persona marker that arrives token by token across events", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    // The marker streams in pieces after glued narration — the split must hold
    // only once the full `**BA:**` marker has assembled.
    for (const t of ["ready.", "**", "BA", ":", "**", " Are you a dev?\n"]) {
      sp.last().emitStdout(chunk(t) + "\n");
    }

    expect(turns).toEqual([
      { speaker: "system", text: "ready." },
      { speaker: "BA", text: "Are you a dev?" },
    ]);
  });

  it("keeps a persona's wrapped continuation lines under the same persona until another speaks", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    // A persona speaks, its answer wraps onto an unprefixed line, then a new
    // persona takes over and its answer also wraps.
    sp.last().emitStdout(chunk("**BA:** first line\nsecond line\n") + "\n");
    sp.last().emitStdout(chunk("**Dev:** dev line\ndev continuation\n") + "\n");

    expect(turns).toEqual([
      { speaker: "BA", text: "first line" },
      { speaker: "BA", text: "second line" },
      { speaker: "Dev", text: "dev line" },
      { speaker: "Dev", text: "dev continuation" },
    ]);
  });

  it("ignores non-agent events and malformed JSON lines", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    sp.last().emitStdout('{"type":"runStarted","data":{}}\n');
    sp.last().emitStdout("not json at all\n");
    sp.last().emitStdout(chunk("**QA:** ok\n") + "\n");
    expect(turns).toEqual([{ speaker: "QA", text: "ok" }]);
  });
});

describe("makeKiroAgentRunner — terminal failures", () => {
  it("maps a non-zero exit to a terminal error turn and ends the session", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    let exits = 0;
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t), onExit: () => (exits += 1) });

    sp.last().emitExit(1);

    expect(turns).toContainEqual({ speaker: "error", text: "agent exited with code 1" });
    expect(exits).toBe(1);
  });

  it("maps a spawn error to a terminal error turn", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    sp.last().emitError(new Error("kiro-cli not found"));

    expect(turns).toContainEqual({ speaker: "error", text: "kiro-cli not found" });
  });

  it("emits no turns after a terminal end — a later exit or stdout is dropped", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    sp.last().emitError(new Error("boom"));
    sp.last().emitExit(1);
    sp.last().emitStdout(chunk("**BA:** late\n") + "\n");

    expect(turns).toEqual([{ speaker: "error", text: "boom" }]);
  });

  it("stop() kills the active child and ends the session exactly once", () => {
    const sp = fakeSpawner();
    const runner = makeKiroAgentRunner(sp.spawn);
    let exits = 0;
    const session = runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: () => {}, onExit: () => (exits += 1) });

    session.stop();

    expect(sp.last().killed).toBe(true);
    expect(exits).toBe(1);
    sp.last().emitExit(null);
    expect(exits).toBe(1);
  });
});
