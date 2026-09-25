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
});
