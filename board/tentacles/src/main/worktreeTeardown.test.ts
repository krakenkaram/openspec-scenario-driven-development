import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import core, { type Args } from "./core";
import type { ArchiveResult } from "../shared/ipc-contract";

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

// An archiver that faithfully performs what `openspec archive` does on disk: move
// the change under changes/archive/. Injected so the acceptance test never depends
// on the openspec binary (mirrors archive.test.ts's injectable archiver).
function fsArchiver(repoPath: string, change: string): Promise<ArchiveResult> {
  const from = path.join(repoPath, "openspec", "changes", change);
  const to = path.join(repoPath, "openspec", "changes", "archive", change);
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return Promise.resolve({ ok: true });
  } catch (e) {
    return Promise.resolve({ ok: false, error: String(e) });
  }
}

// Seed a real git repository (primary checkout on master) with one linked worktree
// on `feat/x`, holding one live change `add-x`. The branch is cut from master's HEAD
// so it is merged (an ancestor of master) and the working tree is clean.
function seedRepoWithLinkedWorktree(): { primary: string; wt: string } {
  const primary = fs.mkdtempSync(path.join(os.tmpdir(), "td-primary-"));
  created.push(primary);
  fs.mkdirSync(path.join(primary, "openspec", "changes"), { recursive: true });
  git(primary, ["init", "-b", "master"]);
  git(primary, ["config", "user.email", "t@t.t"]);
  git(primary, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(primary, "base.txt"), "base\n");
  git(primary, ["add", "base.txt"]);
  git(primary, ["commit", "-m", "base"]);

  const wt = path.join(primary, "..", path.basename(primary) + "-wt-x");
  created.push(wt);
  git(primary, ["worktree", "add", "-b", "feat/x", wt]);
  // The change lives physically in the worktree's own openspec/changes.
  fs.mkdirSync(path.join(wt, "openspec", "changes", "add-x"), { recursive: true });
  return { primary, wt };
}

describe("worktree teardown — archive of the last change in a linked worktree", () => {
  it("removes the worktree and its merged branch after archiving (real git)", async () => {
    const { primary, wt } = seedRepoWithLinkedWorktree();
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    const res = await core.executeArchiveWithTeardown(
      args,
      wt,
      "add-x",
      { acceptUnmerged: false, acceptDirty: false },
      { archiver: fsArchiver }
    );

    expect(res.archived).toBe(true);
    expect(res.worktreeRemoved).toBe(true);
    expect(res.branchDeleted).toBe(true);

    // Real post-conditions: the worktree directory is gone and the branch no longer exists.
    expect(fs.existsSync(wt)).toBe(false);
    const branches = gitOut(primary, ["branch", "--list", "feat/x"]);
    expect(branches).toBe("");
  });
});
