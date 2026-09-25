import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePlanController } from "./planController";
import { makeFakeAgentRunner } from "./agentRunnerFake";

describe("PlanController — starting a refinement session", () => {
  it("starts the tentacles-refinement agent in the picked folder with the first idea", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "plan-start-"));
    const runner = makeFakeAgentRunner();
    const controller = makePlanController(runner, () => {});

    const res = await controller.startSession({ folderPath: folder, idea: "add a dark mode toggle" });

    expect(res).toEqual({ ok: true });
    expect(runner.sessions).toHaveLength(1);
    const session = runner.last();
    expect(session?.options.skill).toBe("tentacles-refinement");
    expect(session?.options.folderPath).toBe(folder);
    expect(session?.options.firstMessage).toBe("add a dark mode toggle");
  });

  it("refuses to start without a folder", async () => {
    const runner = makeFakeAgentRunner();
    const controller = makePlanController(runner, () => {});

    const res = await controller.startSession({ folderPath: "", idea: "anything" });

    expect(res.ok).toBe(false);
    expect(runner.sessions).toHaveLength(0);
  });

  it("forwards agent turns to the push sink and relays user turns to the agent", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "plan-relay-"));
    const runner = makeFakeAgentRunner();
    const pushed: { speaker: string; text: string }[] = [];
    const controller = makePlanController(runner, (t) => pushed.push(t));
    await controller.startSession({ folderPath: folder, idea: "x" });

    runner.last()!.emit({ speaker: "BA", text: "What problem?" });
    expect(pushed).toEqual([{ speaker: "BA", text: "What problem?" }]);

    const res = await controller.sendTurn("my answer");
    expect(res).toEqual({ ok: true });
    expect(runner.last()!.sent).toEqual(["my answer"]);
  });

  it("does not itself probe for or write docs — the agent owns that", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "plan-nodocs-"));
    const runner = makeFakeAgentRunner();
    const controller = makePlanController(runner, () => {});

    await controller.startSession({ folderPath: folder, idea: "x" });

    // The controller performs no docs IO of its own; the folder is untouched by the app.
    expect(fs.existsSync(path.join(folder, ".tentacles"))).toBe(false);
  });
});
