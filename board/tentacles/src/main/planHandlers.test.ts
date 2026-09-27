import { describe, it, expect, vi } from "vitest";
import { makeHandlers, type BoardCore, type PlanController } from "./wiring";
import type { Args } from "./core";
import type { IpcMainInvokeEvent } from "electron";

const args: Args = { repos: [], root: "/Code", depth: 30 };
const noCore = {} as unknown as BoardCore;
const evt = {} as IpcMainInvokeEvent;

function handlersWithPlan(plan?: PlanController) {
  return makeHandlers(noCore, () => args, undefined, undefined, undefined, undefined, undefined, undefined, plan);
}

function fakePlan(): PlanController & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chooseFolder: vi.fn(async () => {
      calls.push("chooseFolder");
      return { path: "/canonical/proj" };
    }),
    startSession: vi.fn(async (p) => {
      calls.push(`startSession:${p.idea}`);
      return { ok: true };
    }),
    sendTurn: vi.fn(async (t) => {
      calls.push(`sendTurn:${t}`);
      return { ok: true };
    }),
    openTicket: vi.fn(async () => {
      calls.push("openTicket");
      return { ok: true };
    }),
    newRefinement: vi.fn(async () => {
      calls.push("newRefinement");
      return { ok: true };
    }),
    shutdown: vi.fn(),
  } as unknown as PlanController & { calls: string[] };
}

describe("PLAN IPC handlers — relay to the controller", () => {
  it("planChooseFolder relays to the controller and returns its path", async () => {
    const plan = fakePlan();
    const res = await handlersWithPlan(plan).planChooseFolder();
    expect(res).toEqual({ path: "/canonical/proj" });
    expect(plan.calls).toEqual(["chooseFolder"]);
  });

  it("startPlanSession relays the idea only", async () => {
    const plan = fakePlan();
    const res = await handlersWithPlan(plan).startPlanSession(evt, { idea: "add dark mode" });
    expect(res).toEqual({ ok: true });
    expect(plan.calls).toEqual(["startSession:add dark mode"]);
  });

  it("openTicket relays to the controller with no path", async () => {
    const plan = fakePlan();
    const res = await handlersWithPlan(plan).openTicket();
    expect(res).toEqual({ ok: true });
    expect(plan.calls).toEqual(["openTicket"]);
  });

  it("newRefinement relays to the controller with no args", async () => {
    const plan = fakePlan();
    const res = await handlersWithPlan(plan).newRefinement();
    expect(res).toEqual({ ok: true });
    expect(plan.calls).toEqual(["newRefinement"]);
  });
});

describe("PLAN IPC handlers — when PLAN is not wired", () => {
  it("reports plan unavailable for start/send/open/new and a null pick", async () => {
    const h = handlersWithPlan(undefined);
    expect(await h.planChooseFolder()).toEqual({ path: null });
    expect(await h.startPlanSession(evt, { idea: "x" })).toEqual({ ok: false, error: "plan unavailable" });
    expect(await h.sendPlanTurn(evt, "x")).toEqual({ ok: false, error: "plan unavailable" });
    expect(await h.openTicket()).toEqual({ ok: false, error: "plan unavailable" });
    expect(await h.newRefinement()).toEqual({ ok: false, error: "plan unavailable" });
  });
});
