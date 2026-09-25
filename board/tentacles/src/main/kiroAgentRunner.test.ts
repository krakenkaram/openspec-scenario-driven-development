import { describe, it, expect } from "vitest";
import { attributeLine, makeKiroAgentRunner, type ChildLike } from "./kiroAgentRunner";
import type { PlanTurn } from "../shared/ipc-contract";

function makeFakeChild() {
  let dataCb: (chunk: string) => void = () => {};
  let exitCb: (code: number | null) => void = () => {};
  let errorCb: (e: Error) => void = () => {};
  const stdinWrites: string[] = [];
  let killed = false;
  const child: ChildLike = {
    stdout: { on: (_e, cb) => (dataCb = cb) },
    stdin: { write: (s) => stdinWrites.push(s) },
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
    emitStdout: (s: string) => dataCb(s),
    emitExit: (code: number | null) => exitCb(code),
    emitError: (e: Error) => errorCb(e),
    get stdinWrites() {
      return stdinWrites;
    },
    get killed() {
      return killed;
    },
  };
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
});

describe("makeKiroAgentRunner — streaming and lifecycle", () => {
  it("writes the opening message verbatim, streams stdout lines as attributed turns, relays user turns, and stops the child", () => {
    const fake = makeFakeChild();
    const runner = makeKiroAgentRunner(() => fake.child);
    const turns: PlanTurn[] = [];

    const session = runner.start({
      skill: "tentacles-refinement",
      folderPath: "/proj",
      firstMessage: "add dark mode",
      onTurn: (t) => turns.push(t),
    });

    // Exact opening protocol: the composed message, newline-terminated, no re-wrap.
    expect(fake.stdinWrites[0]).toBe("add dark mode\n");

    fake.emitStdout("**BA:** Hi\n**QA:** Edge cases?\n");
    expect(turns).toEqual([
      { speaker: "BA", text: "Hi" },
      { speaker: "QA", text: "Edge cases?" },
    ]);

    session.send("my answer");
    expect(fake.stdinWrites).toContain("my answer\n");

    session.stop();
    expect(fake.killed).toBe(true);
  });

  it("buffers a partial line until its newline arrives", () => {
    const fake = makeFakeChild();
    const runner = makeKiroAgentRunner(() => fake.child);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    fake.emitStdout("**BA:** half");
    expect(turns).toHaveLength(0);
    fake.emitStdout(" of a line\n");
    expect(turns).toEqual([{ speaker: "BA", text: "half of a line" }]);
  });

  it("maps a non-zero exit to a terminal error turn", () => {
    const fake = makeFakeChild();
    const runner = makeKiroAgentRunner(() => fake.child);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    fake.emitExit(1);

    expect(turns).toContainEqual({ speaker: "error", text: "agent exited with code 1" });
  });

  it("maps a spawn error to a terminal error turn", () => {
    const fake = makeFakeChild();
    const runner = makeKiroAgentRunner(() => fake.child);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    fake.emitError(new Error("kiro-cli not found"));

    expect(turns).toContainEqual({ speaker: "error", text: "kiro-cli not found" });
  });

  it("signals onExit exactly once when the agent exits", () => {
    const fake = makeFakeChild();
    const runner = makeKiroAgentRunner(() => fake.child);
    let exits = 0;
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: () => {}, onExit: () => (exits += 1) });

    fake.emitExit(0);

    expect(exits).toBe(1);
  });

  it("signals onExit once on a spawn error and not again on a following exit", () => {
    const fake = makeFakeChild();
    const runner = makeKiroAgentRunner(() => fake.child);
    let exits = 0;
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: () => {}, onExit: () => (exits += 1) });

    fake.emitError(new Error("boom"));
    fake.emitExit(1);

    expect(exits).toBe(1);
  });

  it("emits no turns after onExit — a later exit or stdout is dropped", () => {
    const fake = makeFakeChild();
    const runner = makeKiroAgentRunner(() => fake.child);
    const turns: PlanTurn[] = [];
    runner.start({ skill: "s", folderPath: "/p", firstMessage: "hi", onTurn: (t) => turns.push(t) });

    fake.emitError(new Error("boom"));
    fake.emitExit(1);
    fake.emitStdout("**BA:** late\n");

    expect(turns).toEqual([{ speaker: "error", text: "boom" }]);
  });
});
