import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import core, { userSchemasDir, copySchemaIntoStore, type Args } from "./core";

let home: string; // fake HOME whose user schema store we manage
let repo: string; // a discovered "app repo": holds openspec/changes + a project schema to copy
let outside: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "schema-home-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "schema-repo-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "schema-out-"));
  fs.mkdirSync(path.join(repo, "openspec", "changes", "demo"), { recursive: true });
  fs.mkdirSync(path.join(repo, "refactor"), { recursive: true });
  fs.writeFileSync(path.join(repo, "refactor", "schema.yaml"), "name: refactor\n");
});

afterEach(() => {
  for (const d of [home, repo, outside]) fs.rmSync(d, { recursive: true, force: true });
});

describe("copySchemaIntoStore — install copy + authorization", () => {
  it("copies a project schema into the user store", () => {
    const res = copySchemaIntoStore("refactor", "project", path.join(repo, "refactor"), home);
    expect(res).toEqual({ ok: true });
    expect(fs.existsSync(path.join(userSchemasDir(home), "refactor", "schema.yaml"))).toBe(true);
  });

  it("refuses a non-project schema and copies nothing", () => {
    const res = copySchemaIntoStore("refactor", "package", path.join(repo, "refactor"), home);
    expect(res).toEqual({ ok: false, error: "only local (app) schemas can be installed" });
    expect(fs.existsSync(path.join(userSchemasDir(home), "refactor"))).toBe(false);
  });

  it("refuses a traversal name and writes nothing outside the store", () => {
    const res = copySchemaIntoStore("../evil", "project", path.join(repo, "refactor"), home);
    expect(res).toEqual({ ok: false, error: "invalid schema name" });
    expect(fs.existsSync(path.join(userSchemasDir(home), "..", "evil"))).toBe(false);
  });

  it("refuses when the schema is already installed", () => {
    const from = path.join(repo, "refactor");
    expect(copySchemaIntoStore("refactor", "project", from, home)).toEqual({ ok: true });
    expect(copySchemaIntoStore("refactor", "project", from, home)).toEqual({ ok: false, error: "already installed" });
  });
});

describe("uninstallSchema — delete only under the user store", () => {
  it("removes an installed schema folder", async () => {
    const store = userSchemasDir(home);
    fs.mkdirSync(path.join(store, "refactor"), { recursive: true });
    expect(await core.uninstallSchema("refactor", home)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(store, "refactor"))).toBe(false);
  });

  it("rejects a traversal name and deletes nothing outside the store", async () => {
    const store = userSchemasDir(home);
    fs.mkdirSync(store, { recursive: true });
    const sentinel = path.join(store, "..", "sentinel");
    fs.mkdirSync(sentinel, { recursive: true });
    expect(await core.uninstallSchema("../sentinel", home)).toEqual({ ok: false, error: "invalid schema name" });
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it("reports when nothing is installed", async () => {
    expect(await core.uninstallSchema("refactor", home)).toEqual({ ok: false, error: "not installed" });
  });
});

describe("openSchemaFile — repo guard before the CLI/opener", () => {
  const args = (repos: string[]): Args => ({ repos, root: "/nonexistent", depth: 1 });

  it("rejects a repoPath that is not a discovered repository, without touching the opener", async () => {
    const opener = vi.fn().mockResolvedValue("");
    const res = await core.openSchemaFile(args([repo]), "refactor", outside, opener);
    expect(res).toEqual({ ok: false, error: "unknown repo or worktree" });
    expect(opener).not.toHaveBeenCalled();
  });

  it("rejects an unsafe schema name before any resolution, without touching the opener", async () => {
    const opener = vi.fn().mockResolvedValue("");
    const res = await core.openSchemaFile(args([repo]), "../evil", repo, opener);
    expect(res).toEqual({ ok: false, error: "invalid schema name" });
    expect(opener).not.toHaveBeenCalled();
  });
});

describe("resolveSchemasRoot — packaged vs development schema cwd", () => {
  it("uses the packaged resources path when the app is packaged", () => {
    expect(core.resolveSchemasRoot(true, "/Applications/App.app/Contents/Resources", "/src/checkout")).toBe(
      "/Applications/App.app/Contents/Resources"
    );
  });

  it("uses the resolved bundle root in development", () => {
    expect(core.resolveSchemasRoot(false, "/ignored/resources", "/src/checkout")).toBe("/src/checkout");
  });

  it("is null when packaged with no resources path", () => {
    expect(core.resolveSchemasRoot(true, "", "/src/checkout")).toBeNull();
  });
});
