import { describe, it, expect } from "vitest";
import { shapeChange } from "./core";
import type { PhaseId } from "../shared/ipc-contract";

// The atdd-driven planning artifacts, in declared order. Declared locally so the
// tests are not coupled to core's fallback-constant name.
const ATDD_PHASES: PhaseId[] = ["grill", "proposal", "specs", "design", "tasks"];

const resolvedFor = (id: string): string =>
  `/nope/openspec/changes/c/${id === "specs" ? "specs/cap/spec.md" : id + ".md"}`;

// Builds an openspec status object over an arbitrary ordered set of artifact
// `keys` (the change's schema artifacts). `present` lists the artifacts that
// exist on disk. A non-existent repo path keeps shapeChange deterministic:
// tasks.md/proposal.md reads fail (defaults), branch resolves null (no gh/git).
function statusWithKeys(keys: string[], present: string[], isPlanningComplete = false, schemaName = "atdd-driven") {
  const artifactPaths: Record<string, { existingOutputPaths: string[]; resolvedOutputPath: string }> = {};
  for (const id of keys) {
    const resolved = resolvedFor(id);
    artifactPaths[id] = {
      existingOutputPaths: present.includes(id) ? [resolved] : [],
      resolvedOutputPath: resolved,
    };
  }
  return { schemaName, isPlanningComplete, artifactPaths };
}

// The atdd-driven status: all five keys present in the artifactPaths map.
function statusWith(present: PhaseId[], isPlanningComplete = false) {
  return statusWithKeys(ATDD_PHASES, present, isPlanningComplete);
}

const byId = (phases: { id: PhaseId; done: boolean; inProgress?: boolean; fileExists: boolean }[]) =>
  Object.fromEntries(phases.map((p) => [p.id, p]));

describe("shapeChange — a phase is complete when the next artifact exists", () => {
  it("shows grill in-progress while only grill.md exists", async () => {
    const c = await shapeChange("/nope/repo", "c", statusWith(["grill"]));
    const p = byId(c.phases);

    expect(p.grill.done).toBe(false);
    expect(p.grill.inProgress).toBe(true);
    // no later planning phase is complete
    expect(p.proposal.done).toBe(false);
    expect(p.specs.done).toBe(false);
    expect(p.design.done).toBe(false);
    expect(p.tasks.done).toBe(false);
  });

  it("marks grill complete and proposal in-progress once proposal.md exists", async () => {
    const c = await shapeChange("/nope/repo", "c", statusWith(["grill", "proposal"]));
    const p = byId(c.phases);

    expect(p.grill.done).toBe(true);
    expect(p.grill.inProgress).toBeFalsy();
    expect(p.proposal.done).toBe(false);
    expect(p.proposal.inProgress).toBe(true);
    expect(p.specs.done).toBe(false);
  });

  it("reports fileExists for an artifact on disk even while the phase is in-progress", async () => {
    const c = await shapeChange("/nope/repo", "c", statusWith(["grill", "proposal"]));
    const p = byId(c.phases);

    // proposal.md is on disk but the phase is still in-progress (done keys on the
    // next artifact) — fileExists must be true so the UI keeps it openable.
    expect(p.proposal.inProgress).toBe(true);
    expect(p.proposal.fileExists).toBe(true);
    // an in-progress phase whose own artifact is NOT yet on disk stays false.
    expect(p.specs.fileExists).toBe(false);
    expect(p.grill.fileExists).toBe(true);
  });

  it("marks specs complete once design.md exists", async () => {
    const c = await shapeChange("/nope/repo", "c", statusWith(["grill", "proposal", "specs", "design"]));
    const p = byId(c.phases);

    expect(p.grill.done).toBe(true);
    expect(p.proposal.done).toBe(true);
    expect(p.specs.done).toBe(true);
    // design's next (tasks) does not exist yet
    expect(p.design.done).toBe(false);
    expect(p.design.inProgress).toBe(true);
  });

  it("falls the final planning phase back to isPlanningComplete", async () => {
    const all: PhaseId[] = ["grill", "proposal", "specs", "design", "tasks"];

    const incomplete = await shapeChange("/nope/repo", "c", statusWith(all, false));
    expect(byId(incomplete.phases).tasks.done).toBe(false);
    expect(byId(incomplete.phases).tasks.inProgress).toBe(true);

    const complete = await shapeChange("/nope/repo", "c", statusWith(all, true));
    const p = byId(complete.phases);
    expect(p.grill.done).toBe(true);
    expect(p.proposal.done).toBe(true);
    expect(p.specs.done).toBe(true);
    expect(p.design.done).toBe(true);
    expect(p.tasks.done).toBe(true);
    expect(p.tasks.inProgress).toBeFalsy();
  });

  it("carries every spec file for a multi-capability specs phase, not just the first", async () => {
    const status = statusWith(["grill", "proposal"]);
    status.artifactPaths.specs.existingOutputPaths = [
      "/nope/openspec/changes/c/specs/cap-a/spec.md",
      "/nope/openspec/changes/c/specs/cap-b/spec.md",
    ];

    const c = await shapeChange("/nope/repo", "c", status);
    const specs = c.phases.find((p) => p.id === "specs");

    expect(specs?.files).toEqual([
      "/nope/openspec/changes/c/specs/cap-a/spec.md",
      "/nope/openspec/changes/c/specs/cap-b/spec.md",
    ]);
  });

  it("carries a single-element files array for a non-specs phase", async () => {
    const c = await shapeChange("/nope/repo", "c", statusWith(["grill", "proposal"]));
    const proposal = c.phases.find((p) => p.id === "proposal");
    expect(proposal?.files).toEqual(["/nope/openspec/changes/c/proposal.md"]);
  });
});

describe("shapeChange — phases are derived from the change's schema artifacts", () => {
  it("renders exactly the atdd-driven five phases in declared order (regression)", async () => {
    const c = await shapeChange("/nope/repo", "c", statusWith(["grill", "proposal"]));
    expect(c.phases.map((p) => p.id)).toEqual(["grill", "proposal", "specs", "design", "tasks"]);
  });

  it("renders only a spec-driven change's own four phases, with no phantom grill", async () => {
    const specDriven = statusWithKeys(
      ["proposal", "specs", "design", "tasks"],
      ["proposal"],
      false,
      "spec-driven"
    );
    const c = await shapeChange("/nope/repo", "c", specDriven);

    expect(c.phases.map((p) => p.id)).toEqual(["proposal", "specs", "design", "tasks"]);
    expect(c.phases.some((p) => p.id === "grill")).toBe(false);
    // every derived phase is applicable by construction
    expect(c.phases.every((p) => p.applicable)).toBe(true);
  });

  it("orders phases by the artifactPaths key order the CLI returns", async () => {
    const status = statusWithKeys(["tasks", "design", "specs", "proposal"], [], false, "custom");
    const c = await shapeChange("/nope/repo", "c", status);
    expect(c.phases.map((p) => p.id)).toEqual(["tasks", "design", "specs", "proposal"]);
  });
});

describe("shapeChange — falls back to the atdd-driven five when status is unusable", () => {
  it("uses the five atdd-driven phases when status is null", async () => {
    const c = await shapeChange("/nope/repo", "c", null);
    expect(c.phases.map((p) => p.id)).toEqual(["grill", "proposal", "specs", "design", "tasks"]);
  });

  it("uses the five atdd-driven phases when artifactPaths is empty", async () => {
    const c = await shapeChange("/nope/repo", "c", { schemaName: "spec-driven", isPlanningComplete: false, artifactPaths: {} });
    expect(c.phases.map((p) => p.id)).toEqual(["grill", "proposal", "specs", "design", "tasks"]);
  });
});
