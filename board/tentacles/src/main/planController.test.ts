import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePlanController } from "./planController";
import { makeFakeAgentRunner } from "./agentRunnerFake";
import type { AgentRunner } from "./agentRunner";

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

describe("PlanController — the agent writes the ticket through the seam", () => {
  it("lets the agent write .tentacles/TICKET.html and revise it as notes are relayed", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "plan-ticket-"));
    const ticket = path.join(folder, ".tentacles", "TICKET.html");

    // A fake agent that writes a ticket on start and rewrites it on a relayed note.
    const runner: AgentRunner = {
      start({ folderPath }) {
        fs.mkdirSync(path.join(folderPath, ".tentacles"), { recursive: true });
        fs.writeFileSync(ticket, "<h1>v1</h1>");
        return {
          send: () => fs.writeFileSync(ticket, "<h1>v2</h1>"),
          stop: () => {},
        };
      },
    };
    const controller = makePlanController(runner, () => {});

    await controller.startSession({ folderPath: folder, idea: "x" });
    expect(fs.readFileSync(ticket, "utf8")).toContain("v1");

    await controller.sendTurn("please change the title");
    expect(fs.readFileSync(ticket, "utf8")).toContain("v2");
  });
});

describe("PlanController — new refinement wipes only the ticket", () => {
  it("deletes only .tentacles/TICKET.html, keeps the docs, and stops the session", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "plan-wipe-"));
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".tentacles", "TICKET.html"), "<h1>ticket</h1>");
    fs.writeFileSync(path.join(folder, ".tentacles", "TENTACLES.md"), "# docs");
    const runner = makeFakeAgentRunner();
    const controller = makePlanController(runner, () => {});
    await controller.startSession({ folderPath: folder, idea: "x" });

    const res = await controller.newRefinement(folder);

    expect(res).toEqual({ ok: true });
    expect(fs.existsSync(path.join(folder, ".tentacles", "TICKET.html"))).toBe(false);
    expect(fs.existsSync(path.join(folder, ".tentacles", "TENTACLES.md"))).toBe(true);
    expect(runner.last()!.stopped).toBe(true);
  });

  it("is a no-op wipe when there is no ticket yet", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "plan-wipe-empty-"));
    const runner = makeFakeAgentRunner();
    const controller = makePlanController(runner, () => {});

    const res = await controller.newRefinement(folder);

    expect(res).toEqual({ ok: true });
  });
});

describe("PlanController — failures surface without retry", () => {
  it("surfaces a start failure as an error turn and does not retry", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "plan-fail-"));
    const runner = makeFakeAgentRunner({ failOnStart: "kiro CLI not found" });
    const pushed: { speaker: string; text: string }[] = [];
    const controller = makePlanController(runner, (t) => pushed.push(t));

    const res = await controller.startSession({ folderPath: folder, idea: "x" });

    expect(res).toEqual({ ok: true });
    expect(pushed).toContainEqual({ speaker: "error", text: "kiro CLI not found" });
    // Exactly one start — no automatic retry.
    expect(runner.sessions).toHaveLength(1);
  });
});
