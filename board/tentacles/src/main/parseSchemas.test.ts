import { describe, it, expect } from "vitest";
import { parseSchemas, parseSchemaPaths, deriveSchemaInfo, planSchemaInstall } from "./core";
import type { RawSchema } from "./core";

// A representative `openspec schemas --json` payload (trimmed): an array of
// entries carrying name, description, an ordered artifacts array, and a source.
const CLI_JSON = JSON.stringify([
  {
    name: "atdd-driven",
    description: "ATDD-driven schema.",
    artifacts: ["grill", "proposal", "specs", "design", "tasks"],
    source: "project",
  },
  {
    name: "spec-driven",
    description: "Default OpenSpec workflow - proposal → specs → design → tasks",
    artifacts: ["proposal", "specs", "design", "tasks"],
    source: "package",
  },
]);

describe("parseSchemas — available schemas from `openspec schemas --json`", () => {
  it("parses each schema's name, description, ordered steps, and source", () => {
    expect(parseSchemas(CLI_JSON)).toEqual([
      {
        name: "atdd-driven",
        description: "ATDD-driven schema.",
        artifacts: ["grill", "proposal", "specs", "design", "tasks"],
        source: "project",
      },
      {
        name: "spec-driven",
        description: "Default OpenSpec workflow - proposal → specs → design → tasks",
        artifacts: ["proposal", "specs", "design", "tasks"],
        source: "package",
      },
    ]);
  });

  it("returns an empty list for non-JSON output without throwing", () => {
    expect(parseSchemas("openspec: command not found")).toEqual([]);
  });

  it("returns an empty list for valid JSON that is not an array of schemas", () => {
    expect(parseSchemas(JSON.stringify({ nope: true }))).toEqual([]);
  });

  it("skips malformed entries, keeps well-formed ones, and defaults a missing source to ''", () => {
    const mixed = JSON.stringify([
      { name: "ok", description: "fine", artifacts: ["a", "b"] },
      { description: "no name", artifacts: ["x"] },
      { name: "no-artifacts", description: "missing artifacts" },
    ]);
    expect(parseSchemas(mixed)).toEqual([{ name: "ok", description: "fine", artifacts: ["a", "b"], source: "" }]);
  });
});

describe("parseSchemaPaths — schema folders from `openspec schema which --all --json`", () => {
  const WHICH_JSON = JSON.stringify([
    { name: "atdd-driven", source: "project", path: "/repo/openspec/schemas/atdd-driven", shadows: [] },
    { name: "spec-driven", source: "package", path: "/pkg/schemas/spec-driven", shadows: [] },
  ]);

  it("maps each schema name to its folder path", () => {
    expect(parseSchemaPaths(WHICH_JSON)).toEqual({
      "atdd-driven": "/repo/openspec/schemas/atdd-driven",
      "spec-driven": "/pkg/schemas/spec-driven",
    });
  });

  it("returns an empty map for non-JSON output without throwing", () => {
    expect(parseSchemaPaths("Note: experimental")).toEqual({});
  });

  it("skips entries missing a name or a path", () => {
    const mixed = JSON.stringify([
      { name: "ok", path: "/p/ok" },
      { name: "no-path", source: "project" },
      { path: "/p/no-name" },
    ]);
    expect(parseSchemaPaths(mixed)).toEqual({ ok: "/p/ok" });
  });
});

describe("deriveSchemaInfo — Global/Local pill + Install/Uninstall action", () => {
  const raw = (name: string, source: string): RawSchema => ({
    name,
    description: `${name} desc`,
    artifacts: ["proposal", "tasks"],
    source,
  });
  const paths = {
    "spec-driven": "/pkg/schemas/spec-driven",
    "atdd-driven": "/repo/openspec/schemas/atdd-driven",
    refactor: "/repo/openspec/schemas/refactor",
  };
  const store = "/home/u/.local/share/openspec/schemas";

  it("marks a package schema Global with no action, pathed at its CLI location", () => {
    const info = deriveSchemaInfo(raw("spec-driven", "package"), paths, new Set(), store);
    expect(info).toEqual({
      name: "spec-driven",
      description: "spec-driven desc",
      artifacts: ["proposal", "tasks"],
      scope: "global",
      action: "none",
      path: "/pkg/schemas/spec-driven",
    });
  });

  it("marks an app-only project schema Local with Install, pathed at the app folder", () => {
    const info = deriveSchemaInfo(raw("refactor", "project"), paths, new Set(), store);
    expect(info.scope).toBe("local");
    expect(info.action).toBe("install");
    expect(info.path).toBe("/repo/openspec/schemas/refactor");
  });

  it("marks a project schema present in the user store Global with Uninstall, pathed at the store copy", () => {
    const info = deriveSchemaInfo(raw("atdd-driven", "project"), paths, new Set(["atdd-driven"]), store);
    expect(info.scope).toBe("global");
    expect(info.action).toBe("uninstall");
    expect(info.path).toBe("/home/u/.local/share/openspec/schemas/atdd-driven");
  });

  it("omits path when the CLI could not resolve one for a not-installed schema", () => {
    const info = deriveSchemaInfo(raw("mystery", "project"), paths, new Set(), store);
    expect(info.path).toBeUndefined();
    expect(info.action).toBe("install");
  });
});

describe("planSchemaInstall — resolve install source and destination", () => {
  const store = "/home/u/.local/share/openspec/schemas";
  const paths = { refactor: "/repo/openspec/schemas/refactor" };

  it("returns the app folder as source and <store>/<name> as destination", () => {
    expect(planSchemaInstall("refactor", paths, store)).toEqual({
      from: "/repo/openspec/schemas/refactor",
      to: "/home/u/.local/share/openspec/schemas/refactor",
    });
  });

  it("errors when the schema name is empty", () => {
    expect(planSchemaInstall("", paths, store)).toEqual({ error: "no schema" });
  });

  it("errors when the schema folder could not be resolved", () => {
    expect(planSchemaInstall("ghost", paths, store)).toEqual({ error: "unknown schema" });
  });
});
