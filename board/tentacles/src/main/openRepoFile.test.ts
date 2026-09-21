import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import core, { type Args } from "./core";
import { makeHandlers } from "./wiring";

const created: string[] = [];
let opener: ReturnType<typeof vi.fn>;

const EVENT = {} as IpcMainInvokeEvent;

afterAll(() => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

beforeEach(() => {
  opener = vi.fn().mockResolvedValue("");
});

function git(dir: string, gitArgs: string[]): void {
  execFileSync("git", gitArgs, { cwd: dir, stdio: "ignore" });
}

// A non-git discovered repo (openspec/changes at its root) with a file inside it.
function makeFlatRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfile-flat-"));
  created.push(dir);
  fs.mkdirSync(path.join(dir, "openspec", "changes", "demo"), { recursive: true });
  fs.writeFileSync(path.join(dir, "notes.md"), "# notes\n");
  return dir;
}

// A git repo whose discovered project lives in a sub-directory (nested layout),
// so a diff path is relative to the OUTER git top-level, not the scanned dir.
function makeNestedRepo(): { root: string; proj: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openfile-nested-"));
  created.push(root);
  git(root, ["init", "-b", "master"]);
  const proj = path.join(root, "proj");
  fs.mkdirSync(path.join(proj, "openspec", "changes"), { recursive: true });
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src", "big.ts"), "export const x = 1;\n");
  return { root, proj };
}

describe("openRepoFile — guarded open-in-editor for a file inside a discovered repo", () => {
  it("opens a file inside a discovered repo, passing its canonical path to the opener", async () => {
    const dir = makeFlatRepo();
    const args: Args = { repos: [dir], root: "/nonexistent", depth: 1 };

    const res = await core.openRepoFile(args, dir, "notes.md", opener);

    expect(res).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith(fs.realpathSync(path.join(dir, "notes.md")));
  });

  it("resolves a top-level-relative path against the git top-level (nested layout)", async () => {
    const { root, proj } = makeNestedRepo();
    const args: Args = { repos: [proj], root: "/nonexistent", depth: 1 };

    // The renderer hands back the diff's top-level-relative path ("proj/src/big.ts").
    // Regression: this was joined onto the scanned sub-dir, producing a doubled,
    // non-existent path the shell could never open.
    const res = await core.openRepoFile(args, proj, "proj/src/big.ts", opener);

    expect(res).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith(fs.realpathSync(path.join(root, "proj", "src", "big.ts")));
  });

  it("surfaces the OS error string when the opener reports one", async () => {
    const dir = makeFlatRepo();
    const args: Args = { repos: [dir], root: "/nonexistent", depth: 1 };
    opener = vi.fn().mockResolvedValue("no application knows how to open");

    const res = await core.openRepoFile(args, dir, "notes.md", opener);

    expect(res).toEqual({ ok: false, error: "no application knows how to open" });
  });

  it("rejects a repoPath outside any discovered repo without touching the shell", async () => {
    const dir = makeFlatRepo();
    const args: Args = { repos: [dir], root: "/nonexistent", depth: 1 };

    const res = await core.openRepoFile(args, "/etc", "passwd", opener);

    expect(res.ok).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it("rejects a file path that escapes the repo and never touches the shell", async () => {
    const dir = makeFlatRepo();
    const args: Args = { repos: [dir], root: "/nonexistent", depth: 1 };
    const sentinel = fs.mkdtempSync(path.join(os.tmpdir(), "openfile-outside-"));
    created.push(sentinel);
    const secret = path.join(sentinel, "secret.txt");
    fs.writeFileSync(secret, "TOP-SECRET\n");

    const abs = await core.openRepoFile(args, dir, secret, opener);
    const traversal = await core.openRepoFile(args, dir, path.relative(dir, secret), opener);

    expect(abs.ok).toBe(false);
    expect(traversal.ok).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it("does not follow an in-repo symlink whose real target is outside the repo", async () => {
    const dir = makeFlatRepo();
    const args: Args = { repos: [dir], root: "/nonexistent", depth: 1 };
    const sentinel = fs.mkdtempSync(path.join(os.tmpdir(), "openfile-symlink-"));
    created.push(sentinel);
    fs.writeFileSync(path.join(sentinel, "secret.txt"), "TOP-SECRET\n");
    fs.symlinkSync(path.join(sentinel, "secret.txt"), path.join(dir, "link.txt"), "file");

    const res = await core.openRepoFile(args, dir, "link.txt", opener);

    expect(res.ok).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it("rejects a directory (only regular files open)", async () => {
    const dir = makeFlatRepo();
    const args: Args = { repos: [dir], root: "/nonexistent", depth: 1 };

    const res = await core.openRepoFile(args, dir, "openspec", opener);

    expect(res.ok).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });
});

describe("openFile handler (wiring)", () => {
  it("delegates to the guarded core with the scan args and injected opener", async () => {
    const dir = makeFlatRepo();
    const args = (): Args => ({ repos: [dir], root: "/nonexistent", depth: 1 });
    const handlers = makeHandlers(core, args, undefined, undefined, undefined, opener);

    const res = await handlers.openFile(EVENT, dir, "notes.md");

    expect(res).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith(fs.realpathSync(path.join(dir, "notes.md")));
  });

  it("reports unavailable when no opener is wired", async () => {
    const dir = makeFlatRepo();
    const args = (): Args => ({ repos: [dir], root: "/nonexistent", depth: 1 });
    const handlers = makeHandlers(core, args);

    expect(await handlers.openFile(EVENT, dir, "notes.md")).toEqual({ ok: false, error: "open unavailable" });
  });
});
