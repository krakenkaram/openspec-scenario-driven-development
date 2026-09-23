/*
 * OpenSpec Board — core logic.
 *
 * Forked from board/server.js at the introduction of the Electron app. These
 * are the board's discrete functions with the HTTP server, browser-open, and
 * CLI arg-parsing stripped out — the Electron main process invokes them
 * directly and exposes them over IPC.
 *
 * Zero runtime dependencies (node:child_process + node:fs + node:path + node:os).
 * The two guards from the HTTP board (archive scoped to a discovered repo + real
 * change; file reads scoped inside a discovered repo) are enforced here in
 * archiveChange() and readArtifact() so a renderer bug cannot bypass them.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  Apply,
  ArchiveResult,
  Change,
  DiffFile,
  DiffHunk,
  DiffResult,
  NotificationSetting,
  Phase,
  PhaseId,
  Pr,
  ReadFileResult,
  OpenPathResult,
  SchemaInfo,
  SchemaActionResult,
  StatusResult,
  Target,
} from "../shared/ipc-contract";

export type { NotificationSetting } from "../shared/ipc-contract";

export interface Args {
  repos: string[];
  root: string;
  depth: number;
}

type Archiver = (repoPath: string, change: string) => Promise<ArchiveResult>;

// The untrusted shapes the external CLIs emit — declared, then cast at the parse
// site. Optional-chaining fallbacks treat every field as possibly absent.
interface RawArtifactPath {
  existingOutputPaths?: Array<string | null>;
  resolvedOutputPath?: string | null;
}
interface RawStatus {
  artifactPaths?: Record<string, RawArtifactPath>;
  isPlanningComplete?: boolean;
  schemaName?: string;
}
interface RawPr {
  url: string;
  number?: number;
  state: string;
  reviewDecision?: string;
  isDraft?: boolean;
}

// The atdd-driven planning artifacts, in declared order. Retained ONLY as the
// fallback phase list for when `openspec status` yields no artifactPaths (a
// failed status call), so the chain is never rendered blank. The authoritative
// per-change phase list is derived from the change's own status artifactPaths
// keys — see shapeChange.
export const ATDD_FALLBACK_PHASES: PhaseId[] = ["grill", "proposal", "specs", "design", "tasks"];

export const PRUNE = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  ".venv", "venv", "__pycache__", ".cache", ".next", ".turbo", "coverage",
  "vendor", ".idea", ".vscode", "Pods", "DerivedData",
]);
export const DEFAULT_DEPTH = 30;

// The app has no CLI flags (a double-clicked .app can't take them). It scans
// ~/Code at depth 30 — the same default as board/server.js. TENTACLES_ROOT /
// TENTACLES_DEPTH override the scan root/depth so a launched process can be
// pointed at a seeded fixtures tree (e2e); unset preserves today's behaviour.
export function defaultArgs(): Args {
  const root = process.env.TENTACLES_ROOT || path.join(os.homedir(), "Code");
  const parsedDepth = parseInt(process.env.TENTACLES_DEPTH || "", 10);
  const depth = Number.isFinite(parsedDepth) ? parsedDepth : DEFAULT_DEPTH;
  return { repos: [], root, depth };
}

export function isRepo(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, "openspec", "changes")).isDirectory();
  } catch {
    return false;
  }
}

export function scanRoot(root: string, maxDepth: number): string[] {
  const found: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    if (isRepo(dir)) {
      found.push(dir);
      return;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (PRUNE.has(e.name) || e.name.startsWith(".")) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

export function discoverRepos(args: Args): string[] {
  if (args.repos.length) return args.repos.filter(isRepo);
  return scanRoot(args.root, args.depth);
}

export function listChanges(repo: string): string[] {
  const dir = path.join(repo, "openspec", "changes");
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "archive")
      .map((e) => e.name);
  } catch {
    /* none */
  }
  return names;
}

export function runStatus(repo: string, change: string): Promise<RawStatus | null> {
  return new Promise((resolve) => {
    execFile(
      "openspec",
      ["status", "--change", change, "--json"],
      { cwd: repo, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve(null);
        try {
          resolve(JSON.parse(String(stdout)) as RawStatus);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

// The available OpenSpec schemas, each enriched into a SchemaInfo the Settings
// view can paint directly. Runs `openspec schemas --json` with `cwd` set to the
// repo root (the app's own checkout) so the app's PROJECT schemas resolve, not
// just the CLI's package one — OpenSpec only sees a repo's project schemas when
// the CLI runs inside it. A second `openspec schema which --all --json` supplies
// each schema's resolved folder path. `home` locates the CLI's user store
// (userSchemasDir): a schema whose folder is present there is treated as
// installed (Global + Uninstall). A failed/empty schemas call yields [].
export function listSchemas(cwd?: string, home?: string): Promise<SchemaInfo[]> {
  return new Promise((resolve) => {
    execFile(
      "openspec",
      ["schemas", "--json"],
      { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve([]);
        const raws = parseSchemas(String(stdout));
        execFile(
          "openspec",
          ["schema", "which", "--all", "--json"],
          { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
          (err2, stdout2) => {
            const paths = err2 && !stdout2 ? {} : parseSchemaPaths(String(stdout2));
            const store = home ? userSchemasDir(home) : "";
            const installed = new Set<string>();
            if (store) {
              try {
                for (const d of fs.readdirSync(store, { withFileTypes: true })) {
                  if (d.isDirectory()) installed.add(d.name);
                }
              } catch {
                /* no user store yet — nothing installed */
              }
            }
            resolve(raws.map((r) => deriveSchemaInfo(r, paths, installed, store)));
          }
        );
      }
    );
  });
}

// Combine one raw schema (from `openspec schemas --json`) with the resolved-path
// map and the set of names present in the CLI's user store into the SchemaInfo the
// UI paints. Pure so the whole Global/Local + Install/Uninstall decision is
// unit-tested without touching disk or the CLI:
//   - a package schema is Global with no action (it ships in the CLI);
//   - a schema whose folder is in the user store is Global with Uninstall;
//   - any other (an app-only project schema) is Local with Install.
// The path shown is the user-store copy when installed, else the CLI's resolved
// path — so the small path text always matches the pill.
export function deriveSchemaInfo(
  raw: RawSchema,
  paths: Record<string, string>,
  installedNames: Set<string>,
  userStoreDir: string
): SchemaInfo {
  const installed = installedNames.has(raw.name);
  const isPackage = raw.source === "package";
  const scope = isPackage || installed ? "global" : "local";
  const action = isPackage ? "none" : installed ? "uninstall" : "install";
  const resolvedPath = installed && userStoreDir ? path.join(userStoreDir, raw.name) : paths[raw.name];
  return {
    name: raw.name,
    description: raw.description,
    artifacts: raw.artifacts,
    scope,
    action,
    ...(resolvedPath ? { path: resolvedPath } : {}),
  };
}

// A safe schema name is a single path component — no separators, no traversal,
// not "." or "..". Enforced main-side before any filesystem operation so a
// renderer-supplied name (untrusted, ADR-0002) can never escape the user store.
export function isSafeSchemaName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    name !== "." &&
    name !== ".." &&
    path.basename(name) === name
  );
}

// Resolve where a schema install copies FROM and TO, or the reason it cannot.
// Pure so the whole authorization is unit-tested: the name must be a safe single
// component; the schema must be a `project` (app-owned) schema — never a package
// or already-global one, so a hidden renderer button is not relied on as the
// guard; and its folder must have resolved. Destination is `<userStore>/<name>`.
export function planSchemaInstall(
  name: string,
  source: string,
  from: string | undefined,
  userStoreDir: string
): { from: string; to: string } | { error: string } {
  if (!isSafeSchemaName(name)) return { error: "invalid schema name" };
  if (!from) return { error: "unknown schema" };
  if (source !== "project") return { error: "only local (app) schemas can be installed" };
  return { from, to: path.join(userStoreDir, name) };
}

// Copy a resolved app schema folder into the CLI's user store. Split from the CLI
// resolution so the real copy — with its authorization and already-installed guard
// — is unit-tested against temp dirs without shelling out. Dereferences symlinks so
// the installed schema is self-contained.
export function copySchemaIntoStore(
  name: string,
  source: string,
  from: string | undefined,
  home: string
): SchemaActionResult {
  const plan = planSchemaInstall(name, source, from, userSchemasDir(home));
  if ("error" in plan) return { ok: false, error: plan.error };
  try {
    if (fs.existsSync(plan.to)) return { ok: false, error: "already installed" };
    fs.mkdirSync(path.dirname(plan.to), { recursive: true });
    fs.cpSync(plan.from, plan.to, { recursive: true, dereference: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

// Install a local (app) schema into the CLI's user store so it is usable for work
// in every repo. Resolves the schema's source + folder via `openspec schema which
// <name>` (from the app-bundle cwd, so project schemas resolve) then copies it.
// Only a `project` schema is installable (enforced in planSchemaInstall).
export function installSchema(name: string, cwd: string | undefined, home: string): Promise<SchemaActionResult> {
  return new Promise((resolve) => {
    if (!isSafeSchemaName(name)) return resolve({ ok: false, error: "invalid schema name" });
    execFile(
      "openspec",
      ["schema", "which", name, "--json"],
      { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, error: "could not resolve schema" });
        let source = "";
        let from: string | undefined;
        try {
          const d = JSON.parse(String(stdout)) as { source?: unknown; path?: unknown };
          if (typeof d.source === "string") source = d.source;
          if (typeof d.path === "string") from = d.path;
        } catch {
          /* fall through: from stays undefined -> unknown schema */
        }
        resolve(copySchemaIntoStore(name, source, from, home));
      }
    );
  });
}

// Uninstall a schema previously installed into the CLI's user store: delete
// `<userStore>/<name>`. The name must be a safe single component AND the resolved
// target must be an immediate child of the canonical user store, so a traversal
// name can never delete anything outside it. Refuses when nothing is installed.
export function uninstallSchema(name: string, home: string): Promise<SchemaActionResult> {
  return new Promise((resolve) => {
    if (!isSafeSchemaName(name)) return resolve({ ok: false, error: "invalid schema name" });
    const store = userSchemasDir(home);
    const target = path.join(store, name);
    if (path.dirname(path.resolve(target)) !== path.resolve(store)) {
      return resolve({ ok: false, error: "invalid schema name" });
    }
    try {
      if (!fs.existsSync(target)) return resolve({ ok: false, error: "not installed" });
      fs.rmSync(target, { recursive: true, force: true });
      resolve({ ok: true });
    } catch (e) {
      resolve({ ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    }
  });
}

// Reveal a change's schema definition (its schema.yaml) in the OS file browser.
// Both inputs are untrusted (ADR-0002): `repoPath` is matched against a currently
// discovered repository (mirroring openWorktree/openRepoFile) and the CLI is run
// from that MATCHED main-process path, never the raw renderer string; `name` must
// be a safe single component. The folder is resolved via `openspec schema which
// <name>` and `<folder>/schema.yaml` revealed via the injected opener
// (shell.showItemInFolder). Unknown repo/schema or a missing schema.yaml is
// reported rather than throwing; the shell is never touched on a rejected input.
export function openSchemaFile(
  args: Args,
  name: string,
  repoPath: string | undefined,
  opener: PathOpener
): Promise<OpenPathResult> {
  return new Promise((resolve) => {
    if (!isSafeSchemaName(name)) return resolve({ ok: false, error: "invalid schema name" });
    const repos = discoverRepos(args);
    const match = repos.find((r) => path.resolve(r) === path.resolve(repoPath || ""));
    if (!match) return resolve({ ok: false, error: "unknown repo or worktree" });
    execFile(
      "openspec",
      ["schema", "which", name, "--json"],
      { cwd: path.resolve(match), timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      async (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, error: "could not resolve schema" });
        let folder: string | undefined;
        try {
          const d = JSON.parse(String(stdout)) as { path?: unknown };
          if (typeof d.path === "string") folder = d.path;
        } catch {
          /* fall through to unknown */
        }
        if (!folder) return resolve({ ok: false, error: "unknown schema" });
        const file = path.join(folder, "schema.yaml");
        try {
          if (!fs.statSync(file).isFile()) return resolve({ ok: false, error: "schema.yaml not found" });
        } catch {
          return resolve({ ok: false, error: "schema.yaml not found" });
        }
        const error = await opener(file);
        resolve(error ? { ok: false, error } : { ok: true });
      }
    );
  });
}

export function runArchive(repo: string, change: string): Promise<ArchiveResult> {
  return new Promise((resolve) => {
    execFile(
      "openspec",
      ["archive", change, "--yes", "--skip-specs", "--json"],
      { cwd: repo, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) return resolve({ ok: false, error: (stderr || String(err)).slice(0, 400) });
        resolve({ ok: true });
      }
    );
  });
}

interface TaskProgress {
  total: number;
  done: number;
  reviewTaskDone: boolean | null;
}

export function taskProgress(repo: string, change: string): TaskProgress {
  const p = path.join(repo, "openspec", "changes", change, "tasks.md");
  try {
    const text = fs.readFileSync(p, "utf8");
    const lines = text.split("\n").filter((l) => /^\s*-\s*\[[ xX]\]/.test(l));
    const ticked = (l: string): boolean => /^\s*-\s*\[[xX]\]/.test(l);
    const reviewLine = lines.find((l) => /code[- ]?review|review gate|independent .*review/i.test(l));
    const reviewTaskDone = reviewLine ? ticked(reviewLine) : null;
    const implLines = lines.filter(
      (l) => !/code[- ]?review|review gate|independent .*review|open the pr/i.test(l)
    );
    return {
      total: implLines.length,
      done: implLines.filter(ticked).length,
      reviewTaskDone,
    };
  } catch {
    return { total: 0, done: 0, reviewTaskDone: null };
  }
}

export function changeType(repo: string, change: string): "refactor" | "feature" {
  const p = path.join(repo, "openspec", "changes", change, "proposal.md");
  let text = "";
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return /^refactor[-/]/i.test(change) ? "refactor" : "feature";
  }

  if (/change type:\s*refactor/i.test(text)) return "refactor";
  if (/change type:\s*feature/i.test(text)) return "feature";

  const t = text.toLowerCase();
  const refactorSignals = [
    "behaviour-preserving", "behavior-preserving",
    "no observable-behaviour change", "no observable behaviour change",
    "no observable-behavior change", "no observable behavior change",
    "no production code is modified", "no production behaviour change",
    "implementation-only", "implementation only",
    "no requirement or production behaviour change",
  ];
  const hasRefactorLang = refactorSignals.some((s) => t.includes(s));
  const newCapBlock = (text.match(/###\s*New Capabilities([\s\S]*?)(?=\n##|\n###|$)/i) || [])[1] || "";
  const addsNewCapability = /^\s*-\s+\S/m.test(newCapBlock.replace(/<!--[\s\S]*?-->/g, ""));

  if (hasRefactorLang && !addsNewCapability) return "refactor";
  if (addsNewCapability) return "feature";

  return /^refactor[-/]/i.test(change) ? "refactor" : "feature";
}

export function prForBranch(repo: string, branch: string | null): Promise<Pr | null> {
  return new Promise((resolve) => {
    if (!branch) return resolve(null);
    execFile(
      "gh",
      ["pr", "list", "--head", branch, "--state", "all", "--json", "url,number,state,reviewDecision,isDraft", "--limit", "1"],
      { cwd: repo, timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          const arr = JSON.parse(String(stdout)) as RawPr[];
          const p = arr[0];
          resolve(
            p
              ? { url: p.url, number: p.number ?? 0, state: p.state, reviewDecision: p.reviewDecision || "", isDraft: !!p.isDraft }
              : null
          );
        } catch {
          resolve(null);
        }
      }
    );
  });
}

export function branchCommits(repo: string, branch: string | null): Promise<number> {
  // No shell: git runs via execFile with an argv array, so the repo path and the
  // branch name (resolved from git in the scanned worktree, i.e. untrusted) are
  // passed literally and can never be interpreted as shell metacharacters. Falls
  // back from origin/HEAD to master in TS rather than a shell `||` chain.
  const countAgainst = (base: string): Promise<number | null> =>
    new Promise((res) => {
      execFile(
        "git",
        ["-C", repo, "rev-list", "--count", branch as string, `^${base}`],
        { timeout: 8000 },
        (err, stdout) => {
          if (err) return res(null);
          const n = parseInt(String(stdout).trim(), 10);
          res(Number.isFinite(n) ? n : null);
        }
      );
    });

  return (async () => {
    if (!branch) return 0;
    const primary = await countAgainst("origin/HEAD");
    if (primary !== null) return primary;
    const fallback = await countAgainst("master");
    return fallback ?? 0;
  })();
}

// The git-derived identity of a scanned worktree.
export interface GitIdentity {
  commonDir: string | null;
  branch: string | null;
  isPrimary: boolean;
}

type GitRunner = (args: string[], cwd: string) => Promise<string | null>;

const runGit: GitRunner = (args, cwd) =>
  new Promise((res) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 8000 }, (err, stdout) => {
      if (err) return res(null);
      res(String(stdout).trim());
    });
  });

// Resolve a scanned directory's repository identity and checked-out branch. The
// git runner is injected so callers can substitute a fake. A directory that is
// not inside a git repository resolves to a standalone identity (no common-dir),
// and a detached HEAD resolves to a null branch.
export async function resolveGitIdentity(dir: string, run: GitRunner = runGit): Promise<GitIdentity> {
  const rawCommon = await run(["rev-parse", "--git-common-dir"], dir);
  if (rawCommon === null) return { commonDir: null, branch: null, isPrimary: true };
  const commonDir = path.resolve(dir, rawCommon);
  const rawBranch = await run(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  const branch = rawBranch && rawBranch !== "HEAD" ? rawBranch : null;
  return { commonDir, branch, isPrimary: commonDir === path.resolve(dir, ".git") };
}

// The display identity carried on the change record: the repository name is the
// common-dir's parent basename (never the worktree's own folder), falling back to
// the scanned directory itself for a non-git dir.
function repositoryFields(dir: string, id: GitIdentity): { repositoryId: string; repositoryName: string } {
  if (!id.commonDir) return { repositoryId: dir, repositoryName: path.basename(dir) };
  return { repositoryId: id.commonDir, repositoryName: path.basename(path.dirname(id.commonDir)) };
}

// The impure collaborators shapeChange depends on, injected so tests can assert
// against fakes without shelling out to git / gh.
export interface ShapeDeps {
  resolveIdentity: (dir: string) => Promise<GitIdentity>;
  prLookup: (repo: string, branch: string | null) => Promise<Pr | null>;
  commitCount: (repo: string, branch: string | null) => Promise<number>;
}

const defaultShapeDeps: ShapeDeps = {
  resolveIdentity: (dir) => resolveGitIdentity(dir),
  prLookup: prForBranch,
  commitCount: branchCommits,
};

// Run a git subcommand and return its stdout, or null when the ref/command is
// invalid and produced nothing. `git diff` finds differences and still exits 0;
// `git diff --no-index` exits non-zero when files differ but writes the diff to
// stdout, so a non-empty stdout always wins over the exit code. No shell: the
// repo path and any file/ref are argv elements, never interpreted (see
// branchCommits for the same discipline).
function runGitText(repo: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", repo, ...args], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      const out = String(stdout ?? "");
      if (out.length > 0) return resolve(out);
      if (err) return resolve(null);
      resolve("");
    });
  });
}

// Resolve the merge base (fork point) of the current branch against its upstream
// base, trying origin/HEAD then master. Returns the merge-base commit sha, or null
// when neither ref resolves. Argv-only, no shell (see branchCommits).
async function mergeBase(repo: string): Promise<string | null> {
  for (const base of ["origin/HEAD", "master"]) {
    const out = await runGitText(repo, ["merge-base", base, "HEAD"]);
    if (out !== null && out.trim()) return out.trim();
  }
  return null;
}

// The git top-level of a scanned directory. `git diff` emits AND interprets file
// paths relative to this top-level — which is NOT necessarily the scanned repoPath:
// an OpenSpec change can live in a sub-directory of its git repo (a nested project
// layout), leaving the discovered openspec/changes dir below the top-level. Anchoring
// the branch diff and the open-in-editor path math here (rather than on repoPath)
// keeps both correct for flat repos (top-level == repoPath) and nested ones alike.
// Returns null outside any git repo, so callers fall back to repoPath.
async function gitToplevel(repo: string): Promise<string | null> {
  const out = await runGitText(repo, ["rev-parse", "--show-toplevel"]);
  const top = String(out ?? "").trim();
  return top ? top : null;
}

// Tracked changes as one unified diff: merge-base → working tree, i.e. exactly what
// this branch contributes (committed-on-branch ∪ staged ∪ unstaged) while EXCLUDING
// commits that landed on the base after the branch diverged. Comparing against the
// base tip instead would report upstream-only files as branch removals. Falls back
// to HEAD (working tree vs last commit) when no base ref resolves. quotePath=false
// keeps non-ASCII paths literal in the diff headers.
async function trackedDiff(repo: string): Promise<string> {
  const base = await mergeBase(repo);
  if (base) {
    const out = await runGitText(repo, ["-c", "core.quotePath=false", "diff", base, "--"]);
    if (out !== null) return out;
  }
  const head = await runGitText(repo, ["-c", "core.quotePath=false", "diff", "HEAD", "--"]);
  return head ?? "";
}

// Untracked files are invisible to a normal diff, so each is rendered against
// /dev/null (an all-additions diff) and concatenated. -z gives NUL-delimited,
// unquoted paths so names with spaces, quotes, newlines, or non-ASCII survive
// intact (no trimming); quotePath=false keeps the diff header path literal too.
// --no-index exits 1 with the diff on stdout, which runGitText handles.
async function untrackedDiff(repo: string): Promise<string> {
  const list = await runGitText(repo, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const files = String(list ?? "").split("\0").filter((f) => f.length > 0);
  const parts: string[] = [];
  for (const f of files) {
    const d = await runGitText(repo, ["-c", "core.quotePath=false", "diff", "--no-index", "--", "/dev/null", f]);
    if (d) parts.push(d);
  }
  return parts.join("\n");
}

// Decode one git header path: strip a trailing CR, undo C-quoting (git wraps a
// name in double-quotes and backslash-escapes control chars, `"`, and `\` — with
// core.quotePath=false only single-byte escapes remain, so fromCharCode is exact),
// strip the trailing TAB git appends to terminate an unquoted path that contains
// spaces, and drop the leading a/ or b/ prefix. A legitimate trailing space in the
// name is preserved (only the tab terminator is removed).
function decodeGitPath(raw: string): string {
  let s = raw.replace(/\r$/, "");
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const body = s.slice(1, -1);
    const escapes: Record<string, string> = {
      n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", '"': '"', "\\": "\\",
    };
    let out = "";
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== "\\") { out += body[i]; continue; }
      const n = body[i + 1] ?? "";
      if (n >= "0" && n <= "7") {
        out += String.fromCharCode(parseInt(body.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        out += escapes[n] ?? n;
        i += 1;
      }
    }
    s = out;
  } else {
    s = s.replace(/\t$/, "");
  }
  return s.replace(/^[ab]\//, "");
}

// Pure: raw unified-diff text → structured per-file model. Status is inferred from
// the git header lines (new file / deleted file / rename / Binary / --- +++ /dev/null),
// each hunk's lines classified add / del / context. Index and "\ No newline" lines
// are ignored.
export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of String(raw ?? "").split("\n")) {
    if (line.startsWith("diff --git")) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      file = { path: m ? decodeGitPath(m[2] as string) : "", status: "modified", hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("new file")) { file.status = "added"; continue; }
    if (line.startsWith("deleted file")) { file.status = "deleted"; continue; }
    if (line.startsWith("rename to ")) { file.status = "renamed"; file.path = decodeGitPath(line.slice(10)); continue; }
    if (line.startsWith("rename from ")) { file.status = "renamed"; continue; }
    if (line.startsWith("Binary files")) { file.status = "binary"; continue; }
    if (line.startsWith("--- ")) {
      if (line.slice(4).replace(/\r$/, "") === "/dev/null") file.status = "added";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const rawPath = line.slice(4).replace(/\r$/, "");
      if (rawPath === "/dev/null") file.status = "deleted";
      else file.path = decodeGitPath(line.slice(4));
      continue;
    }
    if (line.startsWith("@@")) {
      // @@ -oldStart[,oldCount] +newStart[,newCount] @@; an omitted count is 1
      // (git writes `@@ -1 +1 @@` for a single-line hunk). Seed the walk from the
      // header so each hunk re-bases and numbers never run across a skipped gap.
      // A line that starts "@@" but does not parse is left header-less (no seeding
      // fields), which the checksum pass below skips.
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const oldStart = parseInt(m[1] as string, 10);
        const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
        const newStart = parseInt(m[3] as string, 10);
        const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;
        hunk = { lines: [], oldStart, oldCount, newStart, newCount };
        oldNo = oldStart;
        newNo = newStart;
      } else {
        hunk = { lines: [] };
        oldNo = 0;
        newNo = 0;
      }
      file.hunks.push(hunk);
      continue;
    }
    if (line.startsWith("\\")) continue;
    if (!hunk) continue;
    if (line.startsWith("+")) hunk.lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    else if (line.startsWith("-")) hunk.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    else if (line.startsWith(" ")) hunk.lines.push({ kind: "context", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }

  // Count checksum: each hunk's old side (context + deletions) must total its
  // header's oldCount and its new side (context + additions) must total newCount.
  // A mismatch means the diff is malformed or the walk is wrong, so throw rather
  // than surface silently mis-numbered lines — getDiff/getFileDiff wrap parseDiff
  // and turn the throw into an { ok: false } result.
  for (const f of files) {
    for (const h of f.hunks) {
      if (h.oldStart === undefined) continue;
      const oldConsumed = h.lines.filter((l) => l.kind !== "add").length;
      const newConsumed = h.lines.filter((l) => l.kind !== "del").length;
      if (oldConsumed !== h.oldCount || newConsumed !== h.newCount) {
        throw new Error(
          `diff hunk line-count mismatch: header @@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@ ` +
            `but consumed old=${oldConsumed} new=${newConsumed}`
        );
      }
    }
  }
  return files;
}

// Guarded branch diff: only for a currently-discovered repo (mirrors readArtifact /
// archiveChange), returning the structured branch-vs-base ∪ working-tree model.
export async function getDiff(args: Args, repoPath: string): Promise<DiffResult> {
  const repos = discoverRepos(args);
  const okRepo = repos.some((r) => path.resolve(r) === path.resolve(repoPath || ""));
  if (!okRepo) return { ok: false, error: "unknown repo" };
  try {
    // git reports paths relative to the top-level, so run the diff from there — for
    // a nested project the scanned dir is below it (see gitToplevel).
    const root = (await gitToplevel(repoPath)) ?? repoPath;
    const raw = [await trackedDiff(root), await untrackedDiff(root)].filter(Boolean).join("\n");
    return { ok: true, files: parseDiff(raw) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// One file's diff with its ENTIRE contents as context (merge-base → working tree),
// so the renderer can show the whole file with the changes highlighted inline. A
// very large --unified window means git emits every unchanged line as context
// rather than the default three around each hunk. Falls back HEAD → untracked
// (--no-index vs /dev/null) exactly as the whole-repo diff does. Guarded to a
// discovered repo like getDiff; the file path is an argv element after `--`, never
// a shell token or an option.
async function fileDiffFullContext(repo: string, repoRoot: string, filePath: string): Promise<string> {
  const ctx = "--unified=1000000";
  const base = await mergeBase(repo);
  if (base) {
    const out = await runGitText(repo, ["-c", "core.quotePath=false", "diff", base, ctx, "--", filePath]);
    if (out) return out;
  }
  const head = await runGitText(repo, ["-c", "core.quotePath=false", "diff", "HEAD", ctx, "--", filePath]);
  if (head) return head;
  // The tracked diffs above also read working-tree state, but git treats an
  // outside-pointing intermediate symlink on a tracked pathspec as a deletion
  // rather than following it off disk. The --no-index fallback is the one path
  // that would follow such a symlink and read arbitrary bytes, so re-validate
  // containment at the point of use, not just at entry: the file must exist as a
  // regular file whose canonical path is still inside the repo right now. A
  // missing path has no untracked content to show and must never reach --no-index
  // — this closes the window where an ancestor absent at entry is created as an
  // outside-pointing symlink before this call. Tracked deletions never get here;
  // they resolve from git's tree above.
  const safe = containedRealPath(repoRoot, filePath);
  if (!safe) return "";
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(safe);
  } catch {
    return "";
  }
  if (!stat.isFile()) return "";
  const untracked = await runGitText(repo, ["-c", "core.quotePath=false", "diff", "--no-index", ctx, "--", "/dev/null", filePath]);
  return untracked ?? "";
}

// Canonicalize a repo-relative path for containment. path.resolve is lexical, so a
// symlinked directory inside the repo whose real target is outside would slip past a
// prefix check; realpath dereferences it. The requested file may not exist yet
// (deleted/untracked cases still reach git), so canonicalize the nearest existing
// ancestor and re-append the missing tail. Returns null when the real target escapes
// the repo's real root.
function containedRealPath(repoRoot: string, filePath: string): string | null {
  let root: string;
  try {
    root = fs.realpathSync(repoRoot);
  } catch {
    return null;
  }
  const target = path.resolve(root, filePath);
  let existing = target;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  let canonical: string;
  try {
    canonical = fs.realpathSync(existing);
  } catch {
    return null;
  }
  const full = tail.length ? path.join(canonical, ...tail) : canonical;
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

export async function getFileDiff(args: Args, repoPath: string, filePath: string): Promise<DiffResult> {
  const repos = discoverRepos(args);
  const okRepo = repos.some((r) => path.resolve(r) === path.resolve(repoPath || ""));
  if (!okRepo) return { ok: false, error: "unknown repo" };
  if (!filePath) return { ok: false, error: "no file" };
  // filePath is top-level-relative (as getDiff reports it), so anchor containment
  // and the git pathspec on the top-level, not the scanned sub-directory.
  const root = (await gitToplevel(repoPath)) ?? repoPath;
  const repoRoot = path.resolve(root);
  const canonical = containedRealPath(repoRoot, filePath);
  if (!canonical) return { ok: false, error: "path outside repo" };
  const relFile = path.relative(fs.realpathSync(repoRoot), canonical);
  try {
    return { ok: true, files: parseDiff(await fileDiffFullContext(root, repoRoot, relFile)) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function shapeChange(
  repo: string,
  change: string,
  status: RawStatus | null,
  deps: Partial<ShapeDeps> = {}
): Promise<Change> {
  const { resolveIdentity, prLookup, commitCount } = { ...defaultShapeDeps, ...deps };
  const artifactPaths = (status && status.artifactPaths) || {};
  const planningComplete = !!(status && status.isPlanningComplete);
  const ownExists = (id: PhaseId): boolean =>
    ((artifactPaths[id]?.existingOutputPaths || []).filter(Boolean) as string[]).length > 0;

  // A planning phase is complete when the NEXT applicable artifact exists — not
  // when its own artifact exists (grill.md is written mid-interview, so keying on
  // it marks grill done while grilling is still ongoing). The last applicable
  // planning phase has no successor, so it falls back to isPlanningComplete. See
  // ADR-0004.
  // The change's planning phases come from its own schema, read as the ordered
  // keys of the status artifactPaths (the CLI returns them in declared artifact
  // order). Falls back to the atdd-driven five only when status yielded no keys,
  // so the chain is never blank. See ADR-0006.
  const derivedIds = Object.keys(artifactPaths);
  const phaseIds: PhaseId[] = derivedIds.length ? derivedIds : ATDD_FALLBACK_PHASES;
  const applicableIds = phaseIds.filter((id) => id in artifactPaths);
  const phases: Phase[] = phaseIds.map((id) => {
    const ap = artifactPaths[id] || {};
    const existing = (ap.existingOutputPaths || []).filter(Boolean) as string[];
    const applicable = id in artifactPaths;
    const pos = applicableIds.indexOf(id);
    const nextId = pos >= 0 ? applicableIds[pos + 1] : undefined;
    const done = !applicable ? false : nextId ? ownExists(nextId) : planningComplete;
    const files = existing.length ? existing : ap.resolvedOutputPath ? [ap.resolvedOutputPath] : [];
    return {
      id,
      applicable,
      done,
      files,
      fileExists: existing.length > 0,
    };
  });
  const nextIdx = phases.findIndex((p) => p.applicable && !p.done);
  if (nextIdx !== -1) {
    const next = phases[nextIdx];
    if (next) next.inProgress = true;
  }

  const prog = taskProgress(repo, change);

  const type = changeType(repo, change);
  const gitId = await resolveIdentity(repo);
  const branch = gitId.branch;
  const { repositoryId, repositoryName } = repositoryFields(repo, gitId);
  const pr = planningComplete && branch ? await prLookup(repo, branch) : null;

  let apply: Apply = { total: prog.total, done: prog.done, source: "tasks.md", file: null };
  if (planningComplete && branch && prog.total > 0 && prog.done === 0) {
    const commits = await commitCount(repo, branch);
    if (commits > 0) apply = { total: prog.total, done: null, commits, source: "commits", file: null };
  }
  const applyDoneByTasks =
    (apply.source === "tasks.md" && apply.total > 0 && apply.done === apply.total) ||
    (apply.source === "commits" && !!pr);

  const ghApproved = pr && (pr.state === "MERGED" || pr.reviewDecision === "APPROVED");
  const reviewEntered = prog.reviewTaskDone === true || ghApproved || !!pr;
  let review: "none" | "pending" | "passed" = "none";
  if (prog.reviewTaskDone === true || ghApproved) review = "passed";
  else if (applyDoneByTasks || pr) review = "pending";
  const reviewPassed = review === "passed";

  const applyDone = applyDoneByTasks || reviewEntered;
  const applying = planningComplete && !applyDone;

  const complete = reviewPassed;

  const tasksFile = path.join(repo, "openspec", "changes", change, "tasks.md");
  apply.file = fs.existsSync(tasksFile) ? tasksFile : null;

  return {
    change,
    repo: path.basename(repo),
    repoPath: repo,
    schema: (status && status.schemaName) || "unknown",
    type,
    phases,
    apply,
    applyDone,
    applying,
    review,
    planningComplete,
    complete,
    pr,
    repositoryId,
    repositoryName,
    branch,
    isPrimary: gitId.isPrimary,
  };
}

// ---------------------------------------------------------------------------
// Completion notifications (pure decision; the native Notification().show()
// lives in wiring.ts). The decision diffs the previous last-seen completion
// state against the freshly shaped changes and returns the edges to notify.
// ---------------------------------------------------------------------------

export interface BoardNotification {
  repo: string;
  change: string;
  kind: "phase" | "complete";
  phase?: string;
  title: string;
  body: string;
}

interface ChangeCompletionState {
  steps: string[];
  complete: boolean;
}

export type NotifyState = Record<string, ChangeCompletionState>;

function notifyKey(c: Change): string {
  return `${c.repoPath}\u0000${c.change}`;
}

// The completed "steps" of a change: each done planning phase, apply once done,
// review once passed, and done once the change is complete. The grill requires a
// per-phase notification for every phase including done; the whole-change edge is
// reported separately as `kind: "complete"`.
function completedSteps(c: Change): string[] {
  const steps: string[] = [];
  for (const p of c.phases) if (p.applicable && p.done) steps.push(p.id);
  if (c.applyDone) steps.push("apply");
  if (c.review === "passed") steps.push("review");
  if (c.complete) steps.push("done");
  return steps;
}

// Given the previous state (null on the first scan) and the freshly shaped
// changes, return the notifications to fire and the next state to remember. On
// the first scan the state is seeded and nothing fires, so a launch burst of
// pre-existing completions is suppressed.
export function computeNotifications(
  prev: NotifyState | null,
  changes: Change[]
): { next: NotifyState; notifications: BoardNotification[] } {
  const next: NotifyState = {};
  for (const c of changes) {
    next[notifyKey(c)] = { steps: completedSteps(c), complete: c.complete };
  }
  if (prev == null) return { next, notifications: [] };

  const notifications: BoardNotification[] = [];
  for (const c of changes) {
    const before = prev[notifyKey(c)] || { steps: [], complete: false };
    const seen = new Set(before.steps);
    for (const step of completedSteps(c)) {
      if (!seen.has(step)) {
        notifications.push({
          repo: c.repo,
          change: c.change,
          kind: "phase",
          phase: step,
          title: `${c.change} — ${step} complete`,
          body: `${c.repo}: ${step} phase finished`,
        });
      }
    }
    if (c.complete && !before.complete) {
      notifications.push({
        repo: c.repo,
        change: c.change,
        kind: "complete",
        title: `${c.change} complete`,
        body: `${c.repo}: all phases done`,
      });
    }
  }
  return { next, notifications };
}

// ---------------------------------------------------------------------------
// Scan-root settings (pure). The disk read/write of settings.json lives in
// wiring.ts; these functions own the shape, tilde expansion, validation, and
// the resolution order.
// ---------------------------------------------------------------------------

export interface Settings {
  root?: string;
  notifications?: NotificationSetting;
  targets?: Target[];
}

// Normalise any persisted/incoming value to a valid tri-state, defaulting to
// "enabled" (full banner + sound) for absent or unrecognised input.
export function parseNotificationSetting(v: unknown): NotificationSetting {
  return v === "silent" || v === "muted" || v === "enabled" ? v : "enabled";
}

export function parseSettings(text: string): Settings {
  try {
    const o = JSON.parse(text) as unknown;
    if (o && typeof o === "object") {
      const out: Settings = {};
      const root = (o as { root?: unknown }).root;
      if (typeof root === "string") out.root = root;
      const notifications = (o as { notifications?: unknown }).notifications;
      if (notifications === "silent" || notifications === "muted" || notifications === "enabled") {
        out.notifications = notifications;
      }
      const targets = parseTargets((o as { targets?: unknown }).targets);
      if (targets.length) out.targets = targets;
      return out;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

// The effective notification preference for a persisted settings object.
export function resolveNotifications(settings: Settings): NotificationSetting {
  return parseNotificationSetting(settings.notifications);
}

export function expandTilde(p: string, home: string = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export type ValidateResult = { ok: true; root: string } | { ok: false; error: string };

// Validate a user-entered scan root: trim, expand a leading ~, and confirm it
// resolves to an existing directory. `isDir` is injected so the check is unit
// testable without touching the real filesystem.
export function validateRoot(
  input: string,
  isDir: (p: string) => boolean = dirExists,
  home: string = os.homedir()
): ValidateResult {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, error: "Enter a directory path." };
  const expanded = expandTilde(raw, home);
  if (!isDir(expanded)) return { ok: false, error: "That directory does not exist." };
  return { ok: true, root: expanded };
}

// Resolution order: persisted setting → TENTACLES_ROOT env → ~/Code.
export function resolveRoot(
  settings: Settings,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  if (settings.root) return settings.root;
  return env.TENTACLES_ROOT || path.join(home, "Code");
}

export async function collect(repos: string[]): Promise<StatusResult> {
  const changes: Change[] = [];
  for (const repo of repos) {
    for (const change of listChanges(repo)) {
      const status = await runStatus(repo, change);
      changes.push(await shapeChange(repo, change, status));
    }
  }
  return { generatedAt: new Date().toISOString(), repoCount: repos.length, changes };
}

// The board's full status payload for the current scan defaults.
export async function getStatus(args: Args = defaultArgs()): Promise<StatusResult> {
  const repos = discoverRepos(args);
  try {
    return await collect(repos);
  } catch (e) {
    return { error: String(e), changes: [] };
  }
}

// Guarded archive: only for a currently-discovered repo AND a real change.
// `archiver` is injectable so the guard is testable without shelling out.
export async function archiveChange(
  args: Args,
  repoPath: string,
  change: string,
  archiver: Archiver = runArchive
): Promise<ArchiveResult> {
  const repos = discoverRepos(args);
  const okRepo = repos.some((r) => path.resolve(r) === path.resolve(repoPath || ""));
  if (!okRepo || !change || !listChanges(repoPath).includes(change)) {
    return { ok: false, error: "unknown repo or change" };
  }
  return archiver(repoPath, change);
}

// Guarded read: only a path resolving inside a currently-discovered repo.
export function readArtifact(args: Args, fp: string): ReadFileResult {
  const repos = discoverRepos(args);
  const allowed = repos.some((r) => path.resolve(String(fp || "")).startsWith(path.resolve(r) + path.sep));
  if (!allowed) {
    return { ok: false, error: "path outside discovered repos" };
  }
  try {
    return { ok: true, contents: fs.readFileSync(fp, "utf8") };
  } catch {
    return { ok: false, error: "not found" };
  }
}

// The native reveal edge (Electron shell.openPath): "" on success, otherwise the
// OS error message. Injected so the guard is testable without a real shell.
export type PathOpener = (target: string) => Promise<string>;

// Guarded reveal: only opens a target that is EXACTLY a currently-discovered
// repo/worktree root, mirroring archiveChange's repo guard. A renderer-supplied
// path is untrusted (ADR-0002), so an unknown path is rejected before the shell
// is ever touched, and the opener is not called.
export async function openWorktree(
  args: Args,
  target: string,
  opener: PathOpener
): Promise<OpenPathResult> {
  const repos = discoverRepos(args);
  const match = repos.find((r) => path.resolve(r) === path.resolve(target || ""));
  if (!match) return { ok: false, error: "unknown repo or worktree" };
  // Open the matched discovered root itself, never the renderer-supplied string:
  // a lexically-equal but non-canonical input (e.g. `<root>/link/..`) must never
  // be the path the OS actually resolves.
  const error = await opener(path.resolve(match));
  return error ? { ok: false, error } : { ok: true };
}

// Guarded open-in-editor for a FILE that appears in a discovered repo's branch
// diff. Where openWorktree reveals a worktree ROOT (matched by exact discovered
// path), this opens a file INSIDE the repo, so its guard is containment: the
// renderer-supplied path — untrusted (ADR-0002) and top-level-relative as getDiff
// reports it, so resolved against the git top-level (the same anchor getDiff /
// getFileDiff use, which is what makes a nested-project path resolve correctly) —
// must canonicalise to a regular file still inside that top-level. A path that
// escapes, points at a non-file, or does not exist is rejected before the shell is
// touched, and the canonical (realpath-resolved) path is opened, never the raw
// input, so an in-repo symlink cannot redirect the OS off disk.
export async function openRepoFile(
  args: Args,
  repoPath: string,
  filePath: string,
  opener: PathOpener
): Promise<OpenPathResult> {
  const repos = discoverRepos(args);
  const okRepo = repos.some((r) => path.resolve(r) === path.resolve(repoPath || ""));
  if (!okRepo) return { ok: false, error: "unknown repo or worktree" };
  if (!filePath) return { ok: false, error: "no file" };
  const root = (await gitToplevel(repoPath)) ?? repoPath;
  const canonical = containedRealPath(path.resolve(root), filePath);
  if (!canonical) return { ok: false, error: "path outside repo" };
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(canonical);
  } catch {
    return { ok: false, error: "not found" };
  }
  if (!stat.isFile()) return { ok: false, error: "not a file" };
  const error = await opener(canonical);
  return error ? { ok: false, error } : { ok: true };
}

// ---------------------------------------------------------------------------
// Setup tool: install planner + doctor checker (pure), the bundle-root resolver,
// and the thin real fs/exec boundary. The planner/checker return DATA (labelled
// steps/checks); wiring.ts iterates them against an injected executor/probe so
// the decision logic is unit-testable without touching disk — the same seam
// `archiveChange` uses via its injectable `archiver`.
// ---------------------------------------------------------------------------

export const KNOWN_TARGETS: Target[] = ["claude", "kiro", "kiro-crew"];

// The workflows the atdd-driven profile must expose (written by Install into the
// global OpenSpec config AND verified in full by Doctor). Matches the
// openspec-setup skill's canonical list.
export const OPENSPEC_WORKFLOWS: string[] = [
  "propose", "explore", "apply", "update", "sync", "archive",
  "new", "continue", "ff", "verify", "bulk-archive", "onboard",
];

// The canonical skills the atdd-driven workflow depends on — copied by Install
// and verified BY NAME by Doctor, so a pre-existing but empty ~/.kiro/skills no
// longer passes. (Ancillary tentacles-* skills also ship but are not workflow
// prerequisites, so they are not required here.)
export const REQUIRED_SKILLS: string[] = [
  "atdd", "openspec-atdd", "openspec-setup", "code-review", "grill-with-docs", "codebase-design", "pr-writing",
];

// The four agent adapters every target must carry. Doctor checks each adapter
// FILE exists (with the target's extension), not merely that the agents dir is
// present.
export const REQUIRED_ADAPTERS: string[] = ["engineer", "product-manager", "code-reviewer", "pr-writer"];

// The complete opsx-* prompt set `openspec init` generates — one per workflow.
// Doctor verifies the FULL set, so a single stray opsx-* file no longer passes.
export const OPSX_PROMPTS: string[] = OPENSPEC_WORKFLOWS.map((w) => `opsx-${w}.prompt.md`);

// The agent-adapter filenames for a target: JSON for Kiro/Kiro Crew, Markdown
// for Claude.
export function adapterFiles(target: Target): string[] {
  const ext = target === "claude" ? ".md" : ".json";
  return REQUIRED_ADAPTERS.map((a) => a + ext);
}

// OpenSpec's user (global) schema directory — where a globally-installed schema
// must live to RESOLVE. Mirrors the CLI's own resolver: $XDG_DATA_HOME/openspec
// when set, else ~/.local/share/openspec (NOT ~/.config/openspec, which is the
// config dir the CLI never reads schemas from).
export function userSchemasDir(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim() ? env.XDG_DATA_HOME : path.join(home, ".local", "share");
  return path.join(xdg, "openspec", "schemas");
}

// Pure doctor-probe parsers (the probe boundary in wiring.ts shells out; these
// decide pass/fail from the output, so they are unit-tested here).

// Which required entries (workflows, skills, adapters, prompts) are absent from
// the set actually present.
export function missingEntries(have: string[], required: string[]): string[] {
  return required.filter((r) => !have.includes(r));
}

// Which required workflows are absent from the configured set.
export function missingWorkflows(have: string[], required: string[]): string[] {
  return missingEntries(have, required);
}

// Whether `openspec schemas --json` (run from a project-free cwd, so only
// user/package sources count) reports the named schema as resolvable.
export function schemaResolves(jsonOutput: string, name: string): boolean {
  try {
    const list = JSON.parse(jsonOutput) as unknown;
    if (!Array.isArray(list)) return false;
    return list.some((s) => typeof s === "object" && s !== null && (s as { name?: unknown }).name === name);
  } catch {
    return false;
  }
}

// Parse `openspec schemas --json` into the board's raw schema list: each entry's
// name, description, ordered artifact steps, and source ("project" | "package" |
// "user", "" when absent). Malformed output (not JSON, not an array) yields []
// rather than throwing, and entries missing a string name or an artifacts array
// are skipped — the same defensive posture as schemaResolves / parseTargets.
// Description defaults to "" when absent. deriveSchemaInfo turns each RawSchema
// into the SchemaInfo the UI paints.
export interface RawSchema {
  name: string;
  description: string;
  artifacts: string[];
  source: string;
}

export function parseSchemas(jsonOutput: string): RawSchema[] {
  let list: unknown;
  try {
    list = JSON.parse(jsonOutput);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: RawSchema[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { name?: unknown; description?: unknown; artifacts?: unknown; source?: unknown };
    if (typeof e.name !== "string") continue;
    if (!Array.isArray(e.artifacts) || !e.artifacts.every((a) => typeof a === "string")) continue;
    out.push({
      name: e.name,
      description: typeof e.description === "string" ? e.description : "",
      artifacts: e.artifacts as string[],
      source: typeof e.source === "string" ? e.source : "",
    });
  }
  return out;
}

// Parse `openspec schema which --all --json` into a name → folder-path map. The
// experimental "Note:" banner goes to stderr, so stdout is clean JSON. Entries
// missing a name or path are skipped; non-JSON yields an empty map.
export function parseSchemaPaths(jsonOutput: string): Record<string, string> {
  let list: unknown;
  try {
    list = JSON.parse(jsonOutput);
  } catch {
    return {};
  }
  if (!Array.isArray(list)) return {};
  const out: Record<string, string> = {};
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { name?: unknown; path?: unknown };
    if (typeof e.name === "string" && typeof e.path === "string") out[e.name] = e.path;
  }
  return out;
}

// `kirocrew doctor` prints "strict identity: ✅ routed" when healthy and a
// negative such as "strict identity: not routed" otherwise, amongst other rows
// (e.g. "kirocrew-core route: ✅ routed"). Isolate the `strict identity:` row so
// a `routed` token on an unrelated row cannot make an unhealthy identity pass;
// then require the positive state on that row AND reject its negative.
export function strictIdentityRouted(output: string): boolean {
  const row = output
    .split(/\r?\n/)
    .find((line) => /strict\s+identity\s*:/i.test(line));
  if (row === undefined) return false;
  return /\brouted\b/i.test(row) && !/\bnot\s+routed\b/i.test(row);
}

// `kirocrew config get agent.session_control` prints the boolean value.
export function sessionControlEnabled(output: string): boolean {
  return /^\s*true\s*$/i.test(output) || /:\s*true\b/i.test(output);
}

// Read a targets array from an untrusted settings body, keeping only known
// target ids (mirrors how parseSettings already ignores a non-string root).
export function parseTargets(value: unknown): Target[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Target => typeof v === "string" && (KNOWN_TARGETS as string[]).includes(v));
}

// A planned install step: a labelled, typed operation. Data, not a call.
export type InstallStep =
  | { id: string; label: string; kind: "copy-dir"; from: string; to: string; dereference?: boolean }
  | { id: string; label: string; kind: "copy-glob"; fromDir: string; prefix: string; to: string }
  | { id: string; label: string; kind: "write-file"; to: string; contents: string }
  | { id: string; label: string; kind: "run-command"; command: string; args: string[]; cwd?: string; requires?: string }
  | { id: string; label: string; kind: "detect-tool"; command: string; hint: string };

// A planned doctor check: a labelled probe. Data, not a call.
export type DoctorCheck =
  | { id: string; label: string; kind: "entries-present"; dir: string; required: string[] }
  | { id: string; label: string; kind: "prompts-present"; dir: string; required: string[] }
  | { id: string; label: string; kind: "schema-resolves"; name: string; cwd: string }
  | { id: string; label: string; kind: "openspec-cli" }
  | { id: string; label: string; kind: "openspec-profile"; configPath: string }
  | { id: string; label: string; kind: "openspec-workflows"; configPath: string; required: string[] }
  | { id: string; label: string; kind: "kirocrew-identity" }
  | { id: string; label: string; kind: "kirocrew-session-control" };

export interface PlanContext {
  repoRoot: string;
  home: string;
}

// Walk up from a starting directory to the openspec-sdd-configure-tool repo root
// (the dir that holds skills/ + agents/ + openspec/schemas). Used so Install
// copies from the local checkout the app runs from (grill D4). Injectable start
// + exists for testing.
export function resolveBundleRoot(
  start: string = __dirname,
  exists: (p: string) => boolean = (p) => fs.existsSync(p)
): string | null {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (exists(path.join(dir, "skills")) && exists(path.join(dir, "openspec", "schemas"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// The directory schema CLI commands (listing / installing Local schemas) run
// from. In a packaged app the app schemas ship as an extraResource under
// process.resourcesPath (which then contains `openspec/schemas`), so that is the
// cwd; in development it is the resolved source-checkout bundle root. Pure so both
// branches are observable in a unit test.
export function resolveSchemasRoot(
  isPackaged: boolean,
  resourcesPath: string,
  bundleRoot: string | null
): string | null {
  return isPackaged ? resourcesPath || null : bundleRoot;
}
// selected targets: each target's file copies, plus the shared OpenSpec global
// slice, with Kiro Crew adding the host-wiring + restart steps on top of Kiro.
// Steps are keyed by id and deduplicated so a multi-select install is idempotent.
export function planInstall(targets: Target[], ctx: PlanContext): InstallStep[] {
  const { repoRoot, home } = ctx;
  const steps: InstallStep[] = [];

  const stepsForTarget = (t: Target): InstallStep[] => {
    switch (t) {
      case "claude":
        return [
          { id: "claude-skills", label: "Copy skills → ~/.claude/skills", kind: "copy-dir", from: path.join(repoRoot, "skills"), to: path.join(home, ".claude", "skills") },
          { id: "claude-agents", label: "Copy agent adapters → ~/.claude/agents", kind: "copy-dir", from: path.join(repoRoot, ".claude", "agents"), to: path.join(home, ".claude", "agents") },
        ];
      case "kiro":
        return [
          { id: "kiro-skills", label: "Copy skills → ~/.kiro/skills", kind: "copy-dir", from: path.join(repoRoot, "skills"), to: path.join(home, ".kiro", "skills") },
          { id: "kiro-agents", label: "Copy agent adapters (dereferenced) → ~/.kiro/agents", kind: "copy-dir", from: path.join(repoRoot, ".kiro", "agents"), to: path.join(home, ".kiro", "agents"), dereference: true },
          { id: "kiro-prompts-generate", label: "Generate opsx-* prompts (openspec init --tools kiro)", kind: "run-command", command: "openspec", args: ["init", "--tools", "kiro", "--profile", "custom", "--no-copilot-cloud"], cwd: repoRoot },
          { id: "kiro-prompts", label: "Copy opsx-* prompts → ~/.kiro/prompts", kind: "copy-glob", fromDir: path.join(repoRoot, ".kiro", "prompts"), prefix: "opsx-", to: path.join(home, ".kiro", "prompts") },
        ];
      case "kiro-crew":
        return [
          ...stepsForTarget("kiro"),
          { id: "crew-wiring", label: "Run setup-kiro-crew.sh (host wiring)", kind: "run-command", command: path.join(repoRoot, "scripts", "setup-kiro-crew.sh"), args: [], cwd: repoRoot, requires: "kirocrew" },
          { id: "crew-restart", label: "Restart the Kiro Crew gateway", kind: "run-command", command: "kirocrew", args: ["restart"], requires: "kirocrew" },
        ];
    }
  };

  for (const t of KNOWN_TARGETS) if (targets.includes(t)) steps.push(...stepsForTarget(t));

  // The OpenSpec global slice — shared by every target. Detect-only for the CLI
  // (never an install step), plus the profile/workflows write and the schema.
  if (targets.length > 0) {
    steps.push(
      { id: "openspec-cli", label: "Detect the OpenSpec CLI", kind: "detect-tool", command: "openspec", hint: "openspec not found — install it (e.g. npm i -g openspec) and re-run" },
      {
        id: "openspec-profile",
        label: "Set OpenSpec profile → custom (with workflows)",
        kind: "write-file",
        to: path.join(home, ".config", "openspec", "config.json"),
        contents: JSON.stringify({ profile: "custom", workflows: OPENSPEC_WORKFLOWS }, null, 2),
      },
      { id: "openspec-schema", label: "Install the atdd-driven schema", kind: "copy-dir", from: path.join(repoRoot, "openspec", "schemas", "atdd-driven"), to: path.join(userSchemasDir(home), "atdd-driven") }
    );
  }

  // Deduplicate by id, preserving first occurrence (keeps a multi-select install
  // idempotent — shared Kiro steps and the OpenSpec slice appear once).
  const seen = new Set<string>();
  return steps.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

// Pure doctor checker. Returns the ordered check list scoped to the selected
// targets, plus the shared OpenSpec checks. Mirrors what planInstall lays down.
export function planDoctorChecks(targets: Target[], ctx: { home: string }): DoctorCheck[] {
  const { home } = ctx;
  const checks: DoctorCheck[] = [];

  const checksForTarget = (t: Target): DoctorCheck[] => {
    switch (t) {
      case "claude":
        return [
          { id: "claude-skills", label: "Claude skills present", kind: "entries-present", dir: path.join(home, ".claude", "skills"), required: REQUIRED_SKILLS },
          { id: "claude-agents", label: "Claude agent adapters present", kind: "entries-present", dir: path.join(home, ".claude", "agents"), required: adapterFiles("claude") },
        ];
      case "kiro":
        return [
          { id: "kiro-skills", label: "Kiro skills present", kind: "entries-present", dir: path.join(home, ".kiro", "skills"), required: REQUIRED_SKILLS },
          { id: "kiro-agents", label: "Kiro agent adapters present", kind: "entries-present", dir: path.join(home, ".kiro", "agents"), required: adapterFiles("kiro") },
          { id: "kiro-prompts", label: "opsx-* prompts present", kind: "prompts-present", dir: path.join(home, ".kiro", "prompts"), required: OPSX_PROMPTS },
        ];
      case "kiro-crew":
        return [
          ...checksForTarget("kiro"),
          { id: "kirocrew-identity", label: "Kiro Crew strict identity routed", kind: "kirocrew-identity" },
          { id: "kirocrew-session-control", label: "agent.session_control enabled", kind: "kirocrew-session-control" },
        ];
    }
  };

  for (const t of KNOWN_TARGETS) if (targets.includes(t)) checks.push(...checksForTarget(t));

  if (targets.length > 0) {
    const configPath = path.join(home, ".config", "openspec", "config.json");
    checks.push(
      { id: "openspec-cli", label: "OpenSpec CLI present", kind: "openspec-cli" },
      { id: "openspec-profile", label: "OpenSpec profile is custom", kind: "openspec-profile", configPath },
      { id: "openspec-workflows", label: "OpenSpec workflows configured", kind: "openspec-workflows", configPath, required: OPENSPEC_WORKFLOWS },
      { id: "openspec-schema", label: "atdd-driven schema resolves", kind: "schema-resolves", name: "atdd-driven", cwd: home }
    );
  }

  const seen = new Set<string>();
  return checks.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export default {
  ATDD_FALLBACK_PHASES,
  PRUNE,
  DEFAULT_DEPTH,
  defaultArgs,
  isRepo,
  scanRoot,
  discoverRepos,
  listChanges,
  runStatus,
  runArchive,
  listSchemas,
  deriveSchemaInfo,
  planSchemaInstall,
  isSafeSchemaName,
  copySchemaIntoStore,
  installSchema,
  uninstallSchema,
  openSchemaFile,
  taskProgress,
  changeType,
  prForBranch,
  branchCommits,
  parseDiff,
  getDiff,
  getFileDiff,
  shapeChange,
  computeNotifications,
  parseSettings,
  parseNotificationSetting,
  resolveNotifications,
  expandTilde,
  dirExists,
  validateRoot,
  resolveRoot,
  parseTargets,
  resolveBundleRoot,
  resolveSchemasRoot,
  planInstall,
  planDoctorChecks,
  OPENSPEC_WORKFLOWS,
  REQUIRED_SKILLS,
  REQUIRED_ADAPTERS,
  OPSX_PROMPTS,
  adapterFiles,
  userSchemasDir,
  missingEntries,
  missingWorkflows,
  schemaResolves,
  parseSchemas,
  strictIdentityRouted,
  sessionControlEnabled,
  collect,
  getStatus,
  archiveChange,
  readArtifact,
  openWorktree,
  openRepoFile,
};
