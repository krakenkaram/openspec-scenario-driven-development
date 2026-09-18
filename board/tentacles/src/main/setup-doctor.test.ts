import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import core, { type Args, type DoctorCheck } from "./core";
import { makeHandlers, makeDoctorProbe, type SetupDeps } from "./wiring";
import type { DoctorArgs, Target } from "../shared/ipc-contract";

const HOME = "/Users/tester";

function handlersWith(probe: SetupDeps["probe"]) {
  const args: Args = { repos: [], root: "/x", depth: 1 };
  const setup: SetupDeps = { repoRoot: "/repo", home: HOME, exec: vi.fn(async () => {}), probe };
  return makeHandlers(core, () => args, undefined, undefined, undefined, undefined, setup);
}

const doctor = (targets: Target[]): DoctorArgs => ({ targets });

describe("doctor checker (core.planDoctorChecks)", () => {
  it("scopes checks to the selected target only", () => {
    const ids = core.planDoctorChecks(["kiro"], { home: HOME }).map((c) => c.id);
    expect(ids).toContain("kiro-skills");
    expect(ids).toContain("kiro-prompts");
    expect(ids.some((id) => id.startsWith("claude-"))).toBe(false);
    expect(ids).not.toContain("kirocrew-identity");
  });

  it("verifies the full OpenSpec slice: cli, profile, workflows, and schema", () => {
    const checks = core.planDoctorChecks(["kiro"], { home: HOME });
    const ids = checks.map((c) => c.id);
    expect(ids).toContain("openspec-cli");
    expect(ids).toContain("openspec-profile");
    expect(ids).toContain("openspec-workflows");
    expect(ids).toContain("openspec-schema");
    // config-reading checks target the INJECTED home, not process.env.HOME
    const profile = checks.find((c) => c.id === "openspec-profile");
    if (profile?.kind === "openspec-profile") expect(profile.configPath.startsWith(HOME)).toBe(true);
    // the workflows check verifies the FULL canonical set, not just new/continue
    const wf = checks.find((c) => c.id === "openspec-workflows");
    if (wf?.kind === "openspec-workflows") {
      expect(wf.required).toContain("propose");
      expect(wf.required).toContain("apply");
      expect(wf.required).toContain("archive");
    }
    // the schema check verifies RESOLVABILITY, not mere directory existence
    const schema = checks.find((c) => c.id === "openspec-schema");
    expect(schema?.kind).toBe("schema-resolves");
    if (schema?.kind === "schema-resolves") expect(schema.name).toBe("atdd-driven");
  });

  it("verifies canonical skills, all four adapters, and the full prompt set by name", () => {
    const kiro = core.planDoctorChecks(["kiro"], { home: HOME });
    const skills = kiro.find((c) => c.id === "kiro-skills");
    // skills are verified BY NAME — a pre-existing empty dir cannot pass
    expect(skills?.kind).toBe("entries-present");
    if (skills?.kind === "entries-present") {
      expect(skills.required).toEqual(core.REQUIRED_SKILLS);
      expect(skills.required.length).toBeGreaterThan(0);
    }
    const agents = kiro.find((c) => c.id === "kiro-agents");
    expect(agents?.kind).toBe("entries-present");
    if (agents?.kind === "entries-present") {
      expect(agents.required).toEqual(["engineer.json", "product-manager.json", "code-reviewer.json", "pr-writer.json"]);
    }
    const prompts = kiro.find((c) => c.id === "kiro-prompts");
    expect(prompts?.kind).toBe("prompts-present");
    if (prompts?.kind === "prompts-present") {
      expect(prompts.required).toEqual(core.OPSX_PROMPTS);
      expect(prompts.required.length).toBe(core.OPENSPEC_WORKFLOWS.length);
    }
    // Claude adapters use the .md extension
    const claudeAgents = core.planDoctorChecks(["claude"], { home: HOME }).find((c) => c.id === "claude-agents");
    if (claudeAgents?.kind === "entries-present") {
      expect(claudeAgents.required).toEqual(["engineer.md", "product-manager.md", "code-reviewer.md", "pr-writer.md"]);
    }
  });

  it("verifies strict identity AND session control for Kiro Crew", () => {
    const ids = core.planDoctorChecks(["kiro-crew"], { home: HOME }).map((c) => c.id);
    expect(ids).toContain("kirocrew-identity");
    expect(ids).toContain("kirocrew-session-control");
  });
});

describe("doctor probe parsers (pure)", () => {
  it("missingWorkflows flags a required workflow absent even when new/continue exist", () => {
    expect(core.missingWorkflows(["new", "continue"], core.OPENSPEC_WORKFLOWS)).toContain("propose");
    expect(core.missingWorkflows(core.OPENSPEC_WORKFLOWS, core.OPENSPEC_WORKFLOWS)).toEqual([]);
  });

  it("missingEntries lists required names absent from what is present", () => {
    expect(core.missingEntries(["atdd"], core.REQUIRED_SKILLS)).toContain("openspec-atdd");
    expect(core.missingEntries(core.REQUIRED_SKILLS, core.REQUIRED_SKILLS)).toEqual([]);
    // extra unrelated entries do not satisfy a required one
    expect(core.missingEntries(["unrelated-a", "unrelated-b"], ["engineer.json"])).toEqual(["engineer.json"]);
  });

  it("schemaResolves detects the named schema in openspec schemas --json output", () => {
    const listed = JSON.stringify([{ name: "spec-driven", source: "package" }, { name: "atdd-driven", source: "user" }]);
    expect(core.schemaResolves(listed, "atdd-driven")).toBe(true);
    const onlyDefault = JSON.stringify([{ name: "spec-driven", source: "package" }]);
    expect(core.schemaResolves(onlyDefault, "atdd-driven")).toBe(false);
    // malformed / non-JSON output is a non-resolution, never a throw
    expect(core.schemaResolves("not json", "atdd-driven")).toBe(false);
  });

  it("strictIdentityRouted accepts a routed result and rejects 'not routed'", () => {
    expect(core.strictIdentityRouted("strict identity: ✅ routed")).toBe(true);
    expect(core.strictIdentityRouted("strict identity: not routed")).toBe(false);
    expect(core.strictIdentityRouted("strict identity: ❌ unidentified")).toBe(false);
  });

  it("strictIdentityRouted ignores a 'routed' token on an unrelated row", () => {
    expect(
      core.strictIdentityRouted(
        "strict identity: ❌ unidentified\nkirocrew-core route: ✅ routed"
      )
    ).toBe(false);
    expect(
      core.strictIdentityRouted(
        "kirocrew-core route: ✅ routed\nstrict identity: ✅ routed"
      )
    ).toBe(true);
  });

  it("sessionControlEnabled accepts true and rejects false", () => {
    expect(core.sessionControlEnabled("true")).toBe(true);
    expect(core.sessionControlEnabled("agent.session_control: true")).toBe(true);
    expect(core.sessionControlEnabled("false")).toBe(false);
    expect(core.sessionControlEnabled("agent.session_control: false")).toBe(false);
  });
});

describe("doctor handler", () => {
  it("reports each check pass or fail for the selected target", async () => {
    // skills present, prompts missing
    const probe = vi.fn(async (check: DoctorCheck) => {
      if (check.id === "kiro-prompts") return { ok: false, reason: "no opsx-* prompts" };
      return { ok: true };
    });
    const handlers = handlersWith(probe);

    const res = await handlers.doctor({} as never, doctor(["kiro"]));

    expect(res.checks.find((c) => c.id === "kiro-skills")?.ok).toBe(true);
    const prompts = res.checks.find((c) => c.id === "kiro-prompts");
    expect(prompts?.ok).toBe(false);
    expect(prompts?.reason).toMatch(/opsx/);
    // scoped to Kiro (+ shared OpenSpec) — no Claude-only or Kiro-Crew-only checks
    expect(res.checks.some((c) => c.id.startsWith("claude-"))).toBe(false);
    expect(res.checks.some((c) => c.id === "kirocrew-identity")).toBe(false);
  });

  it("does not abort when a probe rejects — the row fails and remaining checks still report", async () => {
    const probe = vi.fn(async (check: DoctorCheck) => {
      if (check.id === "kiro-skills") throw new Error("probe blew up");
      return { ok: true };
    });
    const handlers = handlersWith(probe);

    const res = await handlers.doctor({} as never, doctor(["kiro"]));

    const skills = res.checks.find((c) => c.id === "kiro-skills");
    expect(skills?.ok).toBe(false);
    expect(skills?.reason).toMatch(/blew up/);
    // remaining checks still reported
    expect(res.checks.find((c) => c.id === "openspec-cli")).toBeTruthy();
    expect(res.checks.find((c) => c.id === "kiro-prompts")).toBeTruthy();
  });
});

describe("real doctor probe — entries-present / prompts-present / schema-resolves", () => {
  it("fails when the skills dir is empty or holds only unrelated entries", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
    const check: DoctorCheck = { id: "kiro-skills", label: "skills", kind: "entries-present", dir, required: core.REQUIRED_SKILLS };

    const empty = await makeDoctorProbe()(check);
    expect(empty.ok).toBe(false);
    expect(empty.reason).toMatch(/missing/i);

    fs.mkdirSync(path.join(dir, "unrelated-skill"));
    const unrelated = await makeDoctorProbe()(check);
    expect(unrelated.ok).toBe(false);

    // create every required skill dir → passes
    for (const s of core.REQUIRED_SKILLS) fs.mkdirSync(path.join(dir, s), { recursive: true });
    const full = await makeDoctorProbe()(check);
    expect(full.ok).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails when the adapter set is incomplete", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-"));
    const check: DoctorCheck = { id: "kiro-agents", label: "agents", kind: "entries-present", dir, required: core.adapterFiles("kiro") };
    // only one of the four adapters present
    fs.writeFileSync(path.join(dir, "engineer.json"), "{}");
    const partial = await makeDoctorProbe()(check);
    expect(partial.ok).toBe(false);
    expect(partial.reason).toMatch(/product-manager\.json/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails when only some opsx-* prompts are present", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompts-"));
    const check: DoctorCheck = { id: "kiro-prompts", label: "prompts", kind: "prompts-present", dir, required: core.OPSX_PROMPTS };
    // one stray prompt — must NOT pass the full-set check
    fs.writeFileSync(path.join(dir, "opsx-new.prompt.md"), "x");
    const partial = await makeDoctorProbe()(check);
    expect(partial.ok).toBe(false);

    for (const p of core.OPSX_PROMPTS) fs.writeFileSync(path.join(dir, p), "x");
    const full = await makeDoctorProbe()(check);
    expect(full.ok).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails when a schema is not registered anywhere openspec resolves", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "noschema-"));
    // Probe a name that can never be registered (project or user-global), so the
    // assertion is deterministic even after this feature installs atdd-driven
    // globally. This still exercises real non-resolution: the check must fail
    // rather than false-pass on a bare directory (and if openspec is not on PATH
    // the shell-out error is likewise a non-resolution).
    const check: DoctorCheck = { id: "openspec-schema", label: "schema", kind: "schema-resolves", name: "definitely-not-a-real-schema-xyz", cwd };
    const res = await makeDoctorProbe()(check);
    expect(res.ok).toBe(false);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
