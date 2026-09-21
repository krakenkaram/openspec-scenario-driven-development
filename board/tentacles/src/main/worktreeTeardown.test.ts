import { describe, it, expect, afterAll, vi } from "vitest";
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

function seedPrimary(): string {
  const primary = fs.mkdtempSync(path.join(os.tmpdir(), "td-primary-"));
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

function addLinkedWorktree(
  primary: string,
  opts: { branch: string; change: string; diverge?: boolean; dirty?: boolean }
): string {
  const wt = path.join(primary, "..", path.basename(primary) + "-" + opts.branch.replace(/\//g, "-"));
  created.push(wt);
  git(primary, ["worktree", "add", "-b", opts.branch, wt]);
  fs.mkdirSync(path.join(wt, "openspec", "changes", opts.change), { recursive: true });
  if (opts.diverge) {
    fs.writeFileSync(path.join(wt, "diverge.txt"), "unmerged work\n");
    git(wt, ["add", "diverge.txt"]);
    git(wt, ["commit", "-m", "diverge"]);
  }
  if (opts.dirty) fs.writeFileSync(path.join(wt, "untracked.txt"), "scratch\n");
  return wt;
}

describe("worktree teardown — archive of the last change in a linked worktree", () => {
  it("removes the worktree and its merged branch after archiving (real git)", async () => {
    const primary = seedPrimary();
    const wt = addLinkedWorktree(primary, { branch: "feat/x", change: "add-x" });
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    const res = await core.executeArchiveWithTeardown(
      args,
      wt,
      "add-x",
      { acceptUnmerged: false, acceptDirty: false },
      { archiver: fsArchiver }
    );

    expect(res).toMatchObject({ archived: true, worktreeRemoved: true, branchDeleted: true });
    expect(fs.existsSync(wt)).toBe(false);
    expect(gitOut(primary, ["branch", "--list", "feat/x"])).toBe("");
  });
});

describe("worktree teardown — a worktree still holding other live changes is kept", () => {
  it("archives one of two changes and leaves the worktree and branch intact", async () => {
    const primary = seedPrimary();
    const wt = addLinkedWorktree(primary, { branch: "feat/y", change: "a" });
    fs.mkdirSync(path.join(wt, "openspec", "changes", "b"), { recursive: true });
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    const res = await core.executeArchiveWithTeardown(args, wt, "a", { acceptUnmerged: false, acceptDirty: false }, { archiver: fsArchiver });

    expect(res).toMatchObject({ archived: true, worktreeRemoved: null, branchDeleted: null, keptReason: "not-last" });
    expect(fs.existsSync(wt)).toBe(true);
    expect(gitOut(primary, ["branch", "--list", "feat/y"])).not.toBe("");
    expect(fs.existsSync(path.join(wt, "openspec", "changes", "b"))).toBe(true);
  });
});

describe("worktree teardown — the primary worktree is never torn down", () => {
  it("archives the last change in the primary checkout but keeps the worktree", async () => {
    const primary = seedPrimary();
    fs.mkdirSync(path.join(primary, "openspec", "changes", "p"), { recursive: true });
    const args: Args = { repos: [primary], root: "/nonexistent", depth: 1 };

    const res = await core.executeArchiveWithTeardown(args, primary, "p", { acceptUnmerged: false, acceptDirty: false }, { archiver: fsArchiver });

    expect(res).toMatchObject({ archived: true, worktreeRemoved: null, branchDeleted: null, keptReason: "primary" });
    expect(fs.existsSync(primary)).toBe(true);
    expect(gitOut(primary, ["branch", "--list", "master"])).not.toBe("");
  });
});

describe("worktree teardown — branch deletion guarded on merge state", () => {
  it("plans an unmerged warning and only force-deletes the branch on acceptance", async () => {
    const primary = seedPrimary();
    const wt = addLinkedWorktree(primary, { branch: "feat/z", change: "z", diverge: true });
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    const plan = await core.planTeardown(args, wt, "z");
    expect(plan.applies).toBe(true);
    expect(plan.branchMerged).toBe(false);
    expect(plan.warnings.some((w) => /not merged/i.test(w))).toBe(true);

    // WITHOUT acceptance: worktree removed, branch kept.
    const noAccept = await core.executeArchiveWithTeardown(args, wt, "z", { acceptUnmerged: false, acceptDirty: false }, { archiver: fsArchiver });
    expect(noAccept).toMatchObject({ archived: true, worktreeRemoved: true, branchDeleted: false });
    expect(fs.existsSync(wt)).toBe(false);
    expect(gitOut(primary, ["branch", "--list", "feat/z"])).not.toBe("");

    // WITH acceptance on a fresh seed: branch force-deleted.
    const primary2 = seedPrimary();
    const wt2 = addLinkedWorktree(primary2, { branch: "feat/z", change: "z", diverge: true });
    const args2: Args = { repos: [primary2, wt2], root: "/nonexistent", depth: 1 };
    const accept = await core.executeArchiveWithTeardown(args2, wt2, "z", { acceptUnmerged: true, acceptDirty: false }, { archiver: fsArchiver });
    expect(accept).toMatchObject({ archived: true, worktreeRemoved: true, branchDeleted: true });
    expect(gitOut(primary2, ["branch", "--list", "feat/z"])).toBe("");
  });
});

describe("worktree teardown — dirty worktree force-removed only on acceptance", () => {
  it("plans a lost-changes warning and only force-removes the worktree on acceptance", async () => {
    const primary = seedPrimary();
    const wt = addLinkedWorktree(primary, { branch: "feat/d", change: "d", dirty: true });
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    const plan = await core.planTeardown(args, wt, "d");
    expect(plan.dirty).toBe(true);
    expect(plan.warnings.some((w) => /lost/i.test(w))).toBe(true);

    // WITHOUT acceptance: the dirty worktree is not removed.
    const noAccept = await core.executeArchiveWithTeardown(args, wt, "d", { acceptUnmerged: false, acceptDirty: false }, { archiver: fsArchiver });
    expect(noAccept.worktreeRemoved).toBe(false);
    expect(fs.existsSync(wt)).toBe(true);

    // WITH acceptance on a fresh seed: force-removed.
    const primary2 = seedPrimary();
    const wt2 = addLinkedWorktree(primary2, { branch: "feat/d", change: "d", dirty: true });
    const args2: Args = { repos: [primary2, wt2], root: "/nonexistent", depth: 1 };
    const accept = await core.executeArchiveWithTeardown(args2, wt2, "d", { acceptUnmerged: false, acceptDirty: true }, { archiver: fsArchiver });
    expect(accept.worktreeRemoved).toBe(true);
    expect(fs.existsSync(wt2)).toBe(false);
  });
});

describe("worktree teardown — archive-first with per-step partial failure", () => {
  it("leaves the archive standing and reports a worktree-removal failure", async () => {
    const primary = seedPrimary();
    const wt = addLinkedWorktree(primary, { branch: "feat/f", change: "f" });
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    // A TeardownGit whose worktree removal fails; branch deletion must not be attempted.
    let branchAttempted = false;
    const failingGit: import("./core").TeardownGit = {
      isMerged: async () => true,
      isDirty: async () => false,
      removeWorktree: async () => "fatal: worktree is locked",
      deleteBranch: async () => {
        branchAttempted = true;
        return null;
      },
    };

    const res = await core.executeArchiveWithTeardown(
      args,
      wt,
      "f",
      { acceptUnmerged: false, acceptDirty: false },
      { archiver: fsArchiver, git: failingGit }
    );

    expect(res).toMatchObject({ archived: true, worktreeRemoved: false, branchDeleted: null });
    expect(res.worktreeError).toContain("locked");
    expect(branchAttempted).toBe(false);
    // Archive stands: the change was moved under changes/archive/ and the worktree remains.
    expect(fs.existsSync(path.join(wt, "openspec", "changes", "archive", "f"))).toBe(true);
    expect(fs.existsSync(wt)).toBe(true);
  });
});


describe("worktree teardown — nested OpenSpec root (openspec/changes below the git top-level)", () => {
  it("removes the linked worktree's TOP-LEVEL, not the nested discovered dir", async () => {
    const primary = seedPrimary();
    const wt = path.join(primary, "..", path.basename(primary) + "-nested-wt");
    created.push(wt);
    git(primary, ["worktree", "add", "-b", "feat/nested", wt]);
    // The OpenSpec change lives in a sub-project below the worktree's git top-level.
    const nested = path.join(wt, "proj");
    fs.mkdirSync(path.join(nested, "openspec", "changes", "n"), { recursive: true });
    const args: Args = { repos: [primary, nested], root: "/nonexistent", depth: 1 };

    const res = await core.executeArchiveWithTeardown(args, nested, "n", { acceptUnmerged: false, acceptDirty: false }, { archiver: fsArchiver });

    expect(res).toMatchObject({ archived: true, worktreeRemoved: true, branchDeleted: true });
    // The whole worktree top-level is gone, not merely the nested dir.
    expect(fs.existsSync(wt)).toBe(false);
    expect(gitOut(primary, ["branch", "--list", "feat/nested"])).toBe("");
  });

  it("classifies a nested primary checkout as primary and keeps it", async () => {
    const primary = seedPrimary();
    const nested = path.join(primary, "proj");
    fs.mkdirSync(path.join(nested, "openspec", "changes", "np"), { recursive: true });
    const args: Args = { repos: [nested], root: "/nonexistent", depth: 1 };

    const plan = await core.planTeardown(args, nested, "np");
    expect(plan.isPrimary).toBe(true);
    expect(plan.keptReason).toBe("primary");

    const res = await core.executeArchiveWithTeardown(args, nested, "np", { acceptUnmerged: false, acceptDirty: false }, { archiver: fsArchiver });
    expect(res).toMatchObject({ archived: true, worktreeRemoved: null, keptReason: "primary" });
    expect(fs.existsSync(primary)).toBe(true);
  });
});

describe("worktree teardown — merge state uses the same base as the branch diff (origin/HEAD)", () => {
  it("reports unmerged w.r.t. origin/HEAD even when a local base contains the branch", async () => {
    const primary = seedPrimary(); // master at C0
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "td-origin-"));
    created.push(bare);
    git(bare, ["init", "--bare"]);
    git(primary, ["remote", "add", "origin", bare]);
    git(primary, ["push", "-u", "origin", "master"]); // origin/master = C0
    git(primary, ["remote", "set-head", "origin", "master"]); // origin/HEAD -> origin/master (C0)

    // feat/w diverges (Cf) then is merged into LOCAL master, but origin/HEAD stays at C0.
    const wt = addLinkedWorktree(primary, { branch: "feat/w", change: "w", diverge: true });
    git(primary, ["merge", "--ff-only", "feat/w"]); // local master = Cf; origin/HEAD still C0
    const args: Args = { repos: [primary, wt], root: "/nonexistent", depth: 1 };

    const plan = await core.planTeardown(args, wt, "w");
    expect(plan.applies).toBe(true);
    // origin/HEAD is the authoritative base; feat/w is NOT contained by it.
    expect(plan.branchMerged).toBe(false);
    expect(plan.warnings.some((warn) => /not merged/i.test(warn))).toBe(true);
  });
});

describe("worktree teardown — plan is guarded against unknown repo/change", () => {
  it("runs no git or filesystem probe for an undiscovered repo or a non-live change", async () => {
    const primary = seedPrimary();
    const args: Args = { repos: [primary], root: "/nonexistent", depth: 1 };
    const spyGit = {
      isMerged: vi.fn().mockResolvedValue(true),
      isDirty: vi.fn().mockResolvedValue(false),
      removeWorktree: vi.fn().mockResolvedValue(null),
      deleteBranch: vi.fn().mockResolvedValue(null),
    };

    const unknownRepo = await core.planTeardown(args, "/not/a/discovered/repo", "x", spyGit);
    expect(unknownRepo.applies).toBe(false);

    fs.mkdirSync(path.join(primary, "openspec", "changes", "real"), { recursive: true });
    const unknownChange = await core.planTeardown(args, primary, "does-not-exist", spyGit);
    expect(unknownChange.applies).toBe(false);

    expect(spyGit.isMerged).not.toHaveBeenCalled();
    expect(spyGit.isDirty).not.toHaveBeenCalled();
  });
});
