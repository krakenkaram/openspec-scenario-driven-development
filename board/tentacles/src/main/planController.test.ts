import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePlanController, composeOpeningPrompt } from "./planController";
import { makeFakeAgentRunner } from "./agentRunnerFake";
import type { AgentRunner } from "./agentRunner";
import type { ChooseDirectory, OpenPath, PlanController } from "./wiring";
import type { PlanTurn } from "../shared/ipc-contract";

// A realpath-able temp base. Prefer os.tmpdir(); fall back to /tmp when the
// former cannot be canonicalised (some sandboxes point TMPDIR at a path whose
// components refuse lstat). Resolving once here keeps every created folder free
// of surprise symlinks so the containment guard sees a stable canonical root.
function tmpRoot(): string {
  for (const base of [os.tmpdir(), "/tmp"]) {
    try {
      return fs.realpathSync(base);
    } catch {
      /* try the next base */
    }
  }
  return os.tmpdir();
}
const TMP = tmpRoot();

// A fake native picker that hands back a fixed path (or null to model cancel),
// and a fake opener recording targets and returning "" (success) or an error.
function fakeChooser(pathToReturn: string | null): ChooseDirectory {
  return async () => pathToReturn;
}
function fakeOpener(errorFor: (target: string) => string = () => ""): { open: OpenPath; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    open: async (target: string) => {
      calls.push(target);
      return errorFor(target);
    },
  };
}

interface Harness {
  controller: PlanController;
  runner: ReturnType<typeof makeFakeAgentRunner>;
  pushed: PlanTurn[];
  streamed: (PlanTurn | null)[];
  busy: boolean[];
  ended: number;
  opener: { open: OpenPath; calls: string[] };
}

function harness(opts: { folder?: string | null; runner?: AgentRunner; openError?: (t: string) => string } = {}) {
  const runner = (opts.runner as ReturnType<typeof makeFakeAgentRunner>) ?? makeFakeAgentRunner();
  const pushed: PlanTurn[] = [];
  const streamed: (PlanTurn | null)[] = [];
  const busy: boolean[] = [];
  const state = { ended: 0 };
  const opener = fakeOpener(opts.openError);
  const controller = makePlanController(
    runner,
    (t) => pushed.push(t),
    (p) => streamed.push(p),
    () => {
      state.ended += 1;
    },
    (b) => busy.push(b),
    fakeChooser(opts.folder ?? null),
    opener.open
  );
  return { controller, runner, pushed, streamed, busy, opener, get ended() { return state.ended; } } as unknown as Harness;
}

describe("composeOpeningPrompt — the hosted-agent contract", () => {
  it("instructs the agent to bootstrap docs via tentacles-documentation when absent, then refine", () => {
    const prompt = composeOpeningPrompt("add a dark mode toggle");
    expect(prompt).toContain("$tentacles-documentation");
    expect(prompt).toContain("$tentacles-refinement");
    expect(prompt).toContain(".tentacles/TENTACLES.md");
    expect(prompt).toContain("add a dark mode toggle");
  });
});

describe("PlanController — the picked folder is authoritative main-process state", () => {
  it("records the canonical folder from the native picker and starts the agent there", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-start-"));
    const canonical = fs.realpathSync(folder);
    const h = harness({ folder });

    const picked = await h.controller.chooseFolder();
    expect(picked).toEqual({ path: canonical });

    const res = await h.controller.startSession({ idea: "add a dark mode toggle" });
    expect(res).toEqual({ ok: true });
    const session = h.runner.last();
    expect(session?.options.skill).toBe("tentacles-refinement");
    expect(session?.options.folderPath).toBe(canonical);
    expect(session?.options.firstMessage).toBe(composeOpeningPrompt("add a dark mode toggle"));
  });

  it("refuses to start before a folder has been picked (no renderer-supplied path)", async () => {
    const h = harness();
    const res = await h.controller.startSession({ idea: "anything" });
    expect(res.ok).toBe(false);
    expect(h.runner.sessions).toHaveLength(0);
  });

  it("forwards agent turns to the push sink and relays user turns to the agent", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-relay-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });

    h.runner.last()!.emit({ speaker: "BA", text: "What problem?" });
    expect(h.pushed).toEqual([{ speaker: "BA", text: "What problem?" }]);

    const res = await h.controller.sendTurn("my answer");
    expect(res).toEqual({ ok: true });
    expect(h.runner.last()!.sent).toEqual(["my answer"]);
  });

  it("does not itself probe for or write docs — the agent owns that", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-nodocs-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });
    expect(fs.existsSync(path.join(folder, ".tentacles"))).toBe(false);
  });

  it("relays the live partial stream to the push sink for the live session only", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-stream-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });
    const first = h.runner.last()!;

    first.stream({ speaker: "BA", text: "Hel" });
    first.stream({ speaker: "BA", text: "Hello" });
    first.stream(null);
    expect(h.streamed).toEqual([
      { speaker: "BA", text: "Hel" },
      { speaker: "BA", text: "Hello" },
      null,
    ]);

    // Replace the session; the old one's stream must not leak through.
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "again" });
    first.stream({ speaker: "BA", text: "stale" });
    expect(h.streamed).toEqual([
      { speaker: "BA", text: "Hel" },
      { speaker: "BA", text: "Hello" },
      null,
    ]);
  });

  it("relays the agent busy signal to the push sink for the live session only", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-busy-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });
    const first = h.runner.last()!;

    first.busy(true);
    first.busy(false);
    expect(h.busy).toEqual([true, false]);

    // Replace the session; the old one's busy signal must not leak through.
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "again" });
    first.busy(true);
    expect(h.busy).toEqual([true, false]);
  });
});

describe("PlanController — the agent writes the ticket through the seam", () => {
  it("lets the agent write .tentacles/TICKET.html and revise it as notes are relayed", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-ticket-"));
    const ticket = path.join(folder, ".tentacles", "TICKET.html");
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
    const h = harness({ folder, runner });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });
    expect(fs.readFileSync(ticket, "utf8")).toContain("v1");
    await h.controller.sendTurn("please change the title");
    expect(fs.readFileSync(ticket, "utf8")).toContain("v2");
  });
});

describe("PlanController — opening the ticket is guarded and main-owned", () => {
  it("opens the recorded folder's canonical .tentacles/TICKET.html", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-open-"));
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    const ticket = fs.realpathSync(folder) + path.sep + path.join(".tentacles", "TICKET.html");
    fs.writeFileSync(ticket, "<h1>t</h1>");
    const h = harness({ folder });
    await h.controller.chooseFolder();

    const res = await h.controller.openTicket();
    expect(res).toEqual({ ok: true });
    expect(h.opener.calls).toEqual([ticket]);
  });

  it("refuses to open before a folder is picked, without touching the opener", async () => {
    const h = harness();
    const res = await h.controller.openTicket();
    expect(res.ok).toBe(false);
    expect(h.opener.calls).toEqual([]);
  });

  it("refuses when the ticket does not exist yet, without touching the opener", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-noticket-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    const res = await h.controller.openTicket();
    expect(res.ok).toBe(false);
    expect(h.opener.calls).toEqual([]);
  });

  it("surfaces an opener error", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-openerr-"));
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".tentacles", "TICKET.html"), "<h1>t</h1>");
    const h = harness({ folder, openError: () => "no handler" });
    await h.controller.chooseFolder();
    const res = await h.controller.openTicket();
    expect(res).toEqual({ ok: false, error: "no handler" });
  });

  it("rejects a TICKET.html symlink that escapes the folder, without touching the opener", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-symlink-"));
    const outside = fs.mkdtempSync(path.join(TMP, "plan-outside-"));
    const secret = path.join(outside, "secret.html");
    fs.writeFileSync(secret, "<h1>secret</h1>");
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    fs.symlinkSync(secret, path.join(folder, ".tentacles", "TICKET.html"));
    const h = harness({ folder });
    await h.controller.chooseFolder();

    const res = await h.controller.openTicket();
    expect(res.ok).toBe(false);
    expect(h.opener.calls).toEqual([]);
  });

  it("rejects a directory at the TICKET.html path, without touching the opener", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-ticketdir-"));
    fs.mkdirSync(path.join(folder, ".tentacles", "TICKET.html"), { recursive: true });
    const h = harness({ folder });
    await h.controller.chooseFolder();

    const res = await h.controller.openTicket();
    expect(res).toEqual({ ok: false, error: "not a file" });
    expect(h.opener.calls).toEqual([]);
  });
});

describe("PlanController — reading the ticket for in-app viewing is guarded and main-owned", () => {
  it("returns the recorded folder's .tentacles/TICKET.html contents", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-read-"));
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".tentacles", "TICKET.html"), "<h1>the ticket</h1>");
    const h = harness({ folder });
    await h.controller.chooseFolder();

    const res = await h.controller.readTicket();
    expect(res).toEqual({ ok: true, html: "<h1>the ticket</h1>" });
  });

  it("refuses to read before a folder is picked", async () => {
    const h = harness();
    const res = await h.controller.readTicket();
    expect(res.ok).toBe(false);
  });

  it("refuses when the ticket does not exist yet", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-read-none-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    const res = await h.controller.readTicket();
    expect(res).toEqual({ ok: false, error: "no ticket yet" });
  });

  it("rejects a TICKET.html symlink that escapes the folder", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-read-symlink-"));
    const outside = fs.mkdtempSync(path.join(TMP, "plan-read-outside-"));
    const secret = path.join(outside, "secret.html");
    fs.writeFileSync(secret, "<h1>secret</h1>");
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    fs.symlinkSync(secret, path.join(folder, ".tentacles", "TICKET.html"));
    const h = harness({ folder });
    await h.controller.chooseFolder();

    const res = await h.controller.readTicket();
    expect(res.ok).toBe(false);
  });
});

describe("PlanController — new refinement wipes only the ticket", () => {
  it("deletes only .tentacles/TICKET.html, keeps the docs, stops the session, and clears the folder", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-wipe-"));
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".tentacles", "TICKET.html"), "<h1>ticket</h1>");
    fs.writeFileSync(path.join(folder, ".tentacles", "TENTACLES.md"), "# docs");
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });

    const res = await h.controller.newRefinement();

    expect(res).toEqual({ ok: true });
    expect(fs.existsSync(path.join(folder, ".tentacles", "TICKET.html"))).toBe(false);
    expect(fs.existsSync(path.join(folder, ".tentacles", "TENTACLES.md"))).toBe(true);
    expect(h.runner.last()!.stopped).toBe(true);
    // Folder is cleared: a subsequent start refuses until the user re-picks.
    expect((await h.controller.startSession({ idea: "again" })).ok).toBe(false);
  });

  it("is a no-op wipe when there is no folder or ticket", async () => {
    const h = harness();
    const res = await h.controller.newRefinement();
    expect(res).toEqual({ ok: true });
  });

  it("refuses to wipe through a .tentacles symlink that escapes the folder, leaving the outside file", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-wipe-symlink-"));
    const outside = fs.mkdtempSync(path.join(TMP, "plan-wipe-outside-"));
    const outsideTentacles = path.join(outside, ".tentacles");
    fs.mkdirSync(outsideTentacles, { recursive: true });
    const outsideTicket = path.join(outsideTentacles, "TICKET.html");
    fs.writeFileSync(outsideTicket, "<h1>do not delete</h1>");
    // The folder's `.tentacles` is a symlink to the outside directory.
    fs.symlinkSync(outsideTentacles, path.join(folder, ".tentacles"));
    const h = harness({ folder });
    await h.controller.chooseFolder();

    const res = await h.controller.newRefinement();

    expect(res.ok).toBe(false);
    expect(fs.existsSync(outsideTicket)).toBe(true);
  });

  it("removes only the ticket link, not its target, when TICKET.html is a symlink to an in-folder doc", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-wipe-ticketlink-"));
    fs.mkdirSync(path.join(folder, ".tentacles"), { recursive: true });
    const docs = path.join(folder, ".tentacles", "TENTACLES.md");
    fs.writeFileSync(docs, "# docs");
    const ticket = path.join(folder, ".tentacles", "TICKET.html");
    fs.symlinkSync(docs, ticket);
    const h = harness({ folder });
    await h.controller.chooseFolder();

    const res = await h.controller.newRefinement();

    expect(res).toEqual({ ok: true });
    // The docs the ticket pointed at survive; only the ticket link is gone.
    expect(fs.readFileSync(docs, "utf8")).toBe("# docs");
    expect(fs.lstatSync(ticket, { throwIfNoEntry: false })).toBeUndefined();
  });
});

describe("PlanController — terminal session lifecycle", () => {
  it("clears the session and fires ended on agent exit; a later send refuses", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-exit-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });

    h.runner.last()!.exit();

    expect(h.ended).toBe(1);
    const res = await h.controller.sendTurn("too late");
    expect(res.ok).toBe(false);
  });

  it("drops turns from a session that has been replaced by a new one", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-replace-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "first" });
    const first = h.runner.sessions[0];

    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "second" });
    const second = h.runner.sessions[1];

    // The old session was stopped and its late turn must not leak into the new one.
    expect(first.stopped).toBe(true);
    first.emit({ speaker: "BA", text: "stale" });
    second.emit({ speaker: "QA", text: "live" });

    expect(h.pushed).toEqual([{ speaker: "QA", text: "live" }]);
  });

  it("does not fire ended when the session is stopped on shutdown", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-shutdown-"));
    const h = harness({ folder });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });

    h.controller.shutdown();

    expect(h.runner.last()!.stopped).toBe(true);
    // A stop-driven exit from the killed child must not resurface as `ended`.
    h.runner.last()!.exit();
    expect(h.ended).toBe(0);
  });

  it("fires no ended when a synchronous stop() exit races shutdown", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-sync-shutdown-"));
    const runner = makeFakeAgentRunner({ exitOnStop: true });
    const h = harness({ folder, runner });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });

    // stop() fires onExit synchronously; the id must already be invalidated.
    h.controller.shutdown();

    expect(h.ended).toBe(0);
  });

  it("fires no ended and keeps the new session live when a synchronous stop() exit races replacement", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-sync-replace-"));
    const runner = makeFakeAgentRunner({ exitOnStop: true });
    const h = harness({ folder, runner });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "first" });

    // Starting a second session stops the first; its synchronous exit must not
    // fire ended, and the new session must stay live.
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "second" });

    expect(h.ended).toBe(0);
    h.runner.sessions[1].emit({ speaker: "QA", text: "live" });
    expect(h.pushed).toEqual([{ speaker: "QA", text: "live" }]);
  });

  it("fires no ended when a synchronous stop() exit races new refinement", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-sync-new-"));
    const runner = makeFakeAgentRunner({ exitOnStop: true });
    const h = harness({ folder, runner });
    await h.controller.chooseFolder();
    await h.controller.startSession({ idea: "x" });

    await h.controller.newRefinement();

    expect(h.ended).toBe(0);
  });
});

describe("PlanController — failures surface without retry", () => {
  it("surfaces a start failure as an error turn and does not retry", async () => {
    const folder = fs.mkdtempSync(path.join(TMP, "plan-fail-"));
    const runner = makeFakeAgentRunner({ failOnStart: "kiro CLI not found" });
    const h = harness({ folder, runner });
    await h.controller.chooseFolder();

    const res = await h.controller.startSession({ idea: "x" });

    expect(res).toEqual({ ok: true });
    expect(h.pushed).toContainEqual({ speaker: "error", text: "kiro CLI not found" });
    expect(h.runner.sessions).toHaveLength(1);
  });
});
