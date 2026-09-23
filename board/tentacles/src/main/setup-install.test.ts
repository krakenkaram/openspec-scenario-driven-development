import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import core, { type Args, type InstallStep } from "./core";
import { makeHandlers, makeInstallExecutor, type SetupDeps } from "./wiring";
import type { InstallArgs, Target } from "../shared/ipc-contract";

const HOME = "/Users/tester";
const REPO = "/Users/tester/Code/openspec-sdd-configure-tool";

function fakeSetup(over: Partial<SetupDeps> = {}): { setup: SetupDeps; dispatched: InstallStep[] } {
  const dispatched: InstallStep[] = [];
  const setup: SetupDeps = {
    repoRoot: REPO,
    schemasRoot: REPO,
    home: HOME,
    exec: vi.fn(async (step: InstallStep) => {
      dispatched.push(step);
    }),
    probe: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  return { setup, dispatched };
}

function handlersWith(setup: SetupDeps) {
  const args: Args = { repos: [], root: "/x", depth: 1 };
  return makeHandlers(core, () => args, undefined, undefined, undefined, undefined, setup);
}

const install = (targets: Target[]): InstallArgs => ({ targets });

describe("install planner (core.planInstall)", () => {
  it("Kiro Crew is a superset of Kiro plus host wiring", () => {
    const kiro = core.planInstall(["kiro"], { repoRoot: REPO, home: HOME }).map((s) => s.id);
    const crew = core.planInstall(["kiro-crew"], { repoRoot: REPO, home: HOME });
    const crewIds = crew.map((s) => s.id);
    for (const id of kiro) expect(crewIds).toContain(id);
    expect(crewIds).toContain("crew-wiring");
    expect(crewIds).toContain("crew-restart");
    // The host-wiring script no-ops (exit 0) when kirocrew is absent, so the
    // steps declare kirocrew as a prerequisite the executor enforces.
    for (const id of ["crew-wiring", "crew-restart"]) {
      const step = crew.find((s) => s.id === id);
      expect(step?.kind === "run-command" && step.requires).toBe("kirocrew");
    }
  });

  it("does not duplicate shared steps when Kiro and Kiro Crew are both selected", () => {
    const ids = core.planInstall(["kiro", "kiro-crew"], { repoRoot: REPO, home: HOME }).map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("emits a detect-only OpenSpec CLI step and never a CLI install step", () => {
    const steps = core.planInstall(["kiro"], { repoRoot: REPO, home: HOME });
    const cli = steps.find((s) => s.id === "openspec-cli");
    expect(cli?.kind).toBe("detect-tool");
    expect(steps.some((s) => s.kind === "run-command" && /npm|yarn|pnpm/.test(s.command))).toBe(false);
  });

  it("generates the opsx-* prompts before copying them", () => {
    const ids = core.planInstall(["kiro"], { repoRoot: REPO, home: HOME }).map((s) => s.id);
    const gen = ids.indexOf("kiro-prompts-generate");
    const copy = ids.indexOf("kiro-prompts");
    expect(gen).toBeGreaterThanOrEqual(0);
    expect(copy).toBeGreaterThan(gen);
  });

  it("installs the schema into the openspec user data dir so it actually resolves", () => {
    const steps = core.planInstall(["kiro"], { repoRoot: REPO, home: HOME });
    const schema = steps.find((s) => s.id === "openspec-schema");
    expect(schema?.kind).toBe("copy-dir");
    if (schema?.kind === "copy-dir") {
      // must land under the CLI's user schemas dir (~/.local/share/openspec),
      // NOT ~/.config/openspec which the resolver never reads
      expect(schema.to).toBe(path.join(core.userSchemasDir(HOME), "atdd-driven"));
      expect(schema.to).not.toContain(path.join(".config", "openspec"));
    }
  });
});

describe("install handler (run-all-and-report)", () => {
  it("installs a single target and reports every step as a pass", async () => {
    const { setup, dispatched } = fakeSetup();
    const handlers = handlersWith(setup);

    const res = await handlers.install({} as never, install(["kiro"]));

    expect(res.steps.length).toBeGreaterThan(0);
    expect(res.steps.every((r) => r.ok)).toBe(true);
    const tos = dispatched.filter((s) => s.kind === "copy-dir").map((s) => s.to);
    expect(tos).toContain(path.join(HOME, ".kiro", "skills"));
    expect(tos).toContain(path.join(HOME, ".kiro", "agents"));
    const prompts = dispatched.find((s) => s.id === "kiro-prompts");
    expect(prompts?.kind).toBe("copy-glob");
    if (prompts?.kind === "copy-glob") expect(prompts.to).toBe(path.join(HOME, ".kiro", "prompts"));
    expect(dispatched.some((s) => s.id === "openspec-cli")).toBe(true);
  });

  it("fails safely when the bundle root cannot be resolved — nothing is copied", async () => {
    const { setup, dispatched } = fakeSetup({ repoRoot: null });
    const handlers = handlersWith(setup);

    const res = await handlers.install({} as never, install(["kiro"]));

    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]!.ok).toBe(false);
    expect(res.steps[0]!.reason).toMatch(/could not resolve/i);
    expect(dispatched).toHaveLength(0);
  });

  it("does not abort when a step fails — remaining steps still run and report", async () => {
    const { setup } = fakeSetup({
      exec: vi.fn(async (step: InstallStep) => {
        if (step.id === "crew-wiring") throw new Error("kirocrew: command not found");
      }),
    });
    const handlers = handlersWith(setup);

    const res = await handlers.install({} as never, install(["kiro-crew"]));

    const wiring = res.steps.find((r) => r.id === "crew-wiring");
    expect(wiring?.ok).toBe(false);
    expect(wiring?.reason).toMatch(/not found/i);
    // the independent Kiro steps still ran and passed
    expect(res.steps.find((r) => r.id === "kiro-skills")?.ok).toBe(true);
    expect(res.steps.find((r) => r.id === "openspec-profile")?.ok).toBe(true);
  });

  it("reports the OpenSpec CLI as not found without attempting any install", async () => {
    const dispatched: InstallStep[] = [];
    const { setup } = fakeSetup({
      exec: vi.fn(async (step: InstallStep) => {
        dispatched.push(step);
        if (step.kind === "detect-tool") throw new Error("openspec not found — install via npm i -g openspec");
      }),
    });
    const handlers = handlersWith(setup);

    const res = await handlers.install({} as never, install(["kiro"]));

    const cli = res.steps.find((r) => r.id === "openspec-cli");
    expect(cli?.ok).toBe(false);
    expect(cli?.reason).toMatch(/not found/i);
    // never dispatched a package-manager install
    expect(dispatched.some((s) => s.kind === "run-command" && /npm|yarn|pnpm/.test(s.command))).toBe(false);
    // the file-write steps still succeeded
    expect(res.steps.find((r) => r.id === "openspec-profile")?.ok).toBe(true);
  });
});

describe("real install executor — copy-glob (opsx prompts)", () => {
  it("copies opsx-* files from a fixture source to the destination", async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-src-"));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-dst-"));
    fs.rmSync(dest, { recursive: true, force: true }); // ensure the step creates it
    fs.writeFileSync(path.join(src, "opsx-new.prompt.md"), "new");
    fs.writeFileSync(path.join(src, "opsx-continue.prompt.md"), "continue");
    fs.writeFileSync(path.join(src, "unrelated.md"), "skip me");

    const step: InstallStep = { id: "kiro-prompts", label: "prompts", kind: "copy-glob", fromDir: src, prefix: "opsx-", to: dest };
    await makeInstallExecutor()(step);

    expect(fs.existsSync(path.join(dest, "opsx-new.prompt.md"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "opsx-continue.prompt.md"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "unrelated.md"))).toBe(false);

    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it("fails with an actionable reason when the prompt source does not exist", async () => {
    const missing = path.join(os.tmpdir(), "definitely-not-here-" + Date.now());
    const step: InstallStep = { id: "kiro-prompts", label: "prompts", kind: "copy-glob", fromDir: missing, prefix: "opsx-", to: missing + "-dest" };
    await expect(makeInstallExecutor()(step)).rejects.toThrow(/openspec update/i);
  });
});

describe("real install executor — run-command prerequisite gate", () => {
  it("fails a run-command whose required tool is absent, without running the command", async () => {
    // The real setup-kiro-crew.sh exits 0 (no-op) on a non-Kiro-Crew host, so a
    // bare run would report ✅. The `requires` gate makes the row fail honestly.
    // `false` would exit non-zero if it ever ran — the gate must reject first.
    const step: InstallStep = {
      id: "crew-wiring",
      label: "host wiring",
      kind: "run-command",
      command: "false",
      args: [],
      requires: "definitely-not-a-real-tool-" + Date.now(),
    };
    await expect(makeInstallExecutor()(step)).rejects.toThrow(/not found on PATH/i);
  });

  it("runs a run-command with no unmet prerequisite", async () => {
    const step: InstallStep = { id: "noop", label: "noop", kind: "run-command", command: "true", args: [] };
    await expect(makeInstallExecutor()(step)).resolves.toBeUndefined();
  });
});
