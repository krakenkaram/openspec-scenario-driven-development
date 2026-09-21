import { describe, it, expect } from "vitest";
import { parseSchemas } from "./core";

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
  it("parses each schema's name, description, and ordered steps", () => {
    const schemas = parseSchemas(CLI_JSON);
    expect(schemas).toEqual([
      {
        name: "atdd-driven",
        description: "ATDD-driven schema.",
        artifacts: ["grill", "proposal", "specs", "design", "tasks"],
      },
      {
        name: "spec-driven",
        description: "Default OpenSpec workflow - proposal → specs → design → tasks",
        artifacts: ["proposal", "specs", "design", "tasks"],
      },
    ]);
  });

  it("returns an empty list for non-JSON output without throwing", () => {
    expect(parseSchemas("openspec: command not found")).toEqual([]);
  });

  it("returns an empty list for valid JSON that is not an array of schemas", () => {
    expect(parseSchemas(JSON.stringify({ nope: true }))).toEqual([]);
  });

  it("skips malformed entries and keeps well-formed ones", () => {
    const mixed = JSON.stringify([
      { name: "ok", description: "fine", artifacts: ["a", "b"] },
      { description: "no name", artifacts: ["x"] },
      { name: "no-artifacts", description: "missing artifacts" },
    ]);
    expect(parseSchemas(mixed)).toEqual([{ name: "ok", description: "fine", artifacts: ["a", "b"] }]);
  });
});
