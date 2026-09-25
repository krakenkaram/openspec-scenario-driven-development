import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import core, { type Args } from "./core";

const created: string[] = [];

afterAll(() => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

function gitOut(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function seedPrimary(): string {
  const primary = fs.mkdtempSync(path.join(os.tmpdir(), "rm-primary-"));
  created.push(primary);
  fs.mkdirSync(path.join(primary, "openspec", "changes"), { recursive: true });
  git(primary, ["init", "-b", "master"]);
  git(primary, ["config", "user.email", "t@t.t"]);
  git(primary, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(primary, "base.txt"), "base\n");
  git(primary, ["add", "base.txt"]);
  git(primary, ["commit", "-m", "base"]);
  return primary;
}

function addLinkedWorktree(primary: string, branch: string, change: string): string {
  const wt = path.join(primary, "..", path.basename(primary) + "-" + branch.replace(/\//g, "-"));
  created.push(wt);
  git(primary, ["worktree", "add", "-b", branch, wt]);
  fs.mkdirSync(path.join(wt, "openspec", "changes", change), { recursive: true });
  return wt;
}

describe("removeWorktreeFolder — delete a worktree folder outright", () => {
  it("removes a linked worktree's folder and unregisters it (real git)", async () => {
    const primary = seedPrimary();
    const wt = addLinkedWorktree(primary, "feat/x", "add-x");
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    const res = await core.removeWorktreeFolder(args, wt);

    expect(res).toEqual({ ok: true });
    expect(fs.existsSync(wt)).toBe(false);
    expect(gitOut(primary, ["worktree", "list"])).not.toContain(wt);
  });

  it("refuses to delete the primary checkout", async () => {
    const primary = seedPrimary();
    const args: Args = { repos: [primary], root: "/nonexistent", depth: 1 };

    const res = await core.removeWorktreeFolder(args, primary);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/primary/i);
    expect(fs.existsSync(primary)).toBe(true);
  });

  it("refuses a path that is not a discovered worktree", async () => {
    const primary = seedPrimary();
    const args: Args = { repos: [primary], root: "/nonexistent", depth: 1 };

    const res = await core.removeWorktreeFolder(args, path.join(primary, "..", "not-a-repo"));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unknown repo or worktree/i);
  });

  it("operates on the matched worktree, never a symlink/.. alias of the renderer path", async () => {
    const primary = seedPrimary();
    const wt = addLinkedWorktree(primary, "feat/x", "add-x");
    const victim = addLinkedWorktree(primary, "feat/victim", "keep-me");
    const args: Args = { repos: [primary, wt, victim], root: "/nonexistent", depth: 1 };

    // A renderer path that path.resolve() collapses to `wt` (so it clears the
    // lexical guard) but whose on-disk resolution follows the symlink first and
    // lands inside `victim`. Passing this raw string to git would target victim;
    // the guard must use the matched discovered root instead.
    fs.mkdirSync(path.join(victim, "inner"));
    fs.symlinkSync(path.join(victim, "inner"), path.join(wt, "sneak"));
    const aliased = path.join(wt, "sneak", "..");

    const res = await core.removeWorktreeFolder(args, aliased);

    expect(res).toEqual({ ok: true });
    expect(fs.existsSync(wt)).toBe(false); // the matched worktree was removed
    expect(fs.existsSync(victim)).toBe(true); // the symlink-alias target was untouched
    expect(gitOut(primary, ["worktree", "list"])).toContain(victim);
  });
});
