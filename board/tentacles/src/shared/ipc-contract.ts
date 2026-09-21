// Type-only IPC contract: the single source of truth for the board's fourteen
// channels and their payload/result shapes. Everything here is a type, so it
// erases at compile and adds no runtime coupling between the CJS main bundle
// and the Vite renderer bundle.

export type PhaseId = "grill" | "proposal" | "specs" | "design" | "tasks";

export interface Phase {
  id: PhaseId;
  applicable: boolean;
  done: boolean;
  files: string[];
  // The phase's own artifact is on disk. Decoupled from `done`, which keys on
  // the NEXT artifact (ADR-0004): an in-progress artifact awaiting review still
  // has its file, so it stays openable.
  fileExists: boolean;
  inProgress?: boolean;
}

export interface Pr {
  url: string;
  number: number;
  state: string;
  reviewDecision: string;
  isDraft: boolean;
}

export type Apply =
  | { source: "tasks.md"; total: number; done: number; file: string | null }
  | { source: "commits"; total: number; done: null; commits: number; file: string | null };

export interface Change {
  change: string;
  repo: string;
  repoPath: string;
  schema: string;
  type: "refactor" | "feature";
  phases: Phase[];
  apply: Apply;
  applyDone: boolean;
  applying: boolean;
  review: "none" | "pending" | "passed";
  planningComplete: boolean;
  complete: boolean;
  pr: Pr | null;
  // Git-derived worktree identity. repositoryId is the shared common-dir (or the
  // worktree path when not a git repo); repositoryName is the display label
  // derived from the repository, not the worktree folder; branch is the branch
  // checked out in this worktree (null when detached or non-git); isPrimary marks
  // the primary checkout within its repository.
  repositoryId: string;
  repositoryName: string;
  branch: string | null;
  isPrimary: boolean;
}

// A Repository row: the changes carded under one common-dir. `nested` is true only
// when 2+ distinct worktrees (distinct repoPaths) share that common-dir, so a lone
// worktree — even one holding more than one active change — renders exactly as
// today with no extra nesting level and no branch chips.
export interface RepositoryGroup {
  repositoryId: string;
  repositoryName: string;
  nested: boolean;
  worktrees: Change[];
}

export type StatusOk = { generatedAt: string; repoCount: number; changes: Change[] };
export type StatusError = { error: string; changes: [] };
export type StatusResult = StatusOk | StatusError;

export interface ArchiveArgs {
  repoPath: string;
  change: string;
}
// Execute an archive that may tear down the worktree. The acceptances carry the
// user's answer to the single confirmation's enumerated warnings.
export interface ArchiveExecuteArgs {
  repoPath: string;
  change: string;
  acceptUnmerged: boolean;
  acceptDirty: boolean;
}
export type ArchiveResult = { ok: true } | { ok: false; error: string };

// What archiving a change would do to its worktree, computed before the single
// confirmation is shown. `applies` is true only for an eligible teardown (the last
// live Change in a linked, non-primary worktree); otherwise `keptReason` says why
// the worktree is left in place. `warnings` enumerates everything at stake for the
// one informed acceptance (last-change, unmerged branch, uncommitted work).
export interface TeardownPlan {
  applies: boolean;
  keptReason?: "primary" | "not-last";
  isPrimary: boolean;
  worktreePath: string;
  branch: string | null;
  branchMerged: boolean;
  dirty: boolean;
  warnings: string[];
}

// The acceptances the shown warnings imply, carried on execute. They only PERMIT a
// forced step; they can never fabricate one the current git state does not warrant.
export interface TeardownAcceptances {
  acceptUnmerged: boolean;
  acceptDirty: boolean;
}

// Per-step outcome of an archive-with-teardown. A `null` step was not attempted
// (not applicable, primary/not-last, or a prior step failed). The archive runs
// first and always stands once done — later failures are reported, never rolled
// back — so the renderer can tell the user exactly what happened.
export interface ArchiveExecuteResult {
  archived: boolean;
  archiveError?: string;
  worktreeRemoved: boolean | null;
  worktreeError?: string;
  branchDeleted: boolean | null;
  branchError?: string;
  keptReason?: "primary" | "not-last";
}
export type ReadFileResult = { ok: true; contents: string } | { ok: false; error: string };

// A branch diff, structured before it crosses IPC (ADR-0002): the renderer paints
// data, never tints raw text. Each line is classified so the renderer maps kind →
// colour without re-parsing.
export type DiffLineKind = "add" | "del" | "context";
export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  // The line's position in the old (pre-change) and new (post-change) file,
  // computed main-side from the hunk's `@@` header. A line absent on one side
  // (an addition has no old position, a deletion has no new position) omits that
  // field, which the renderer paints as a blank gutter cell.
  oldNo?: number;
  newNo?: number;
}
export interface DiffHunk {
  lines: DiffLine[];
  // The hunk's `@@ -oldStart,oldCount +newStart,newCount @@` header, retained so
  // the numbering walk seeds from the header (never by counting from the top of
  // the file) and the renderer can draw a hunk-header row explaining the jump
  // across skipped regions. Always populated by parseDiff; optional so hand-built
  // model literals (tests) need not restate a header they do not assert on, in
  // which case the renderer simply draws no header row.
  oldStart?: number;
  oldCount?: number;
  newStart?: number;
  newCount?: number;
}
export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed" | "binary";
export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  hunks: DiffHunk[];
}
export type DiffResult = { ok: true; files: DiffFile[] } | { ok: false; error: string };

export interface BoardSettings {
  root: string;
  notifications: NotificationSetting;
  targets: Target[];
}
export interface SetSettingsArgs {
  root: string;
  notifications?: NotificationSetting;
  targets?: Target[];
}
export type SetSettingsResult =
  | { ok: true; root: string; notifications: NotificationSetting; targets: Target[] }
  | { ok: false; error: string };

// How completion notifications are surfaced: a full banner with sound, a silent
// banner (sounds muted), or nothing at all (notifications muted).
export type NotificationSetting = "enabled" | "silent" | "muted";

// A native directory-picker result. `path` is the chosen directory, or null when
// the user cancels the dialog (the renderer then leaves the input untouched).
export type ChooseDirectoryResult = { path: string | null };

// The result of asking the OS to reveal a worktree folder in its file browser.
// `ok` is false with an error string when the path could not be opened (missing
// folder, no handler); the renderer surfaces the failure rather than silently
// swallowing it.
export type OpenPathResult = { ok: true } | { ok: false; error: string };

// A setup Target is an AI coding host the workflow can be configured for. Kiro
// Crew is a superset of Kiro (see CONTEXT.md glossary).
export type Target = "claude" | "kiro" | "kiro-crew";

// One row of an Install run or a Doctor run: a labelled step/check with a
// pass/fail and an optional one-line reason. Install and Doctor share this shape
// so the renderer renders both with one visual language.
export interface ResultRow {
  id: string;
  label: string;
  ok: boolean;
  reason?: string;
}
export interface InstallArgs {
  targets: Target[];
}
export type InstallResult = { steps: ResultRow[] };
export interface DoctorArgs {
  targets: Target[];
}
export type DoctorResult = { checks: ResultRow[] };

// Exact method → channel-name mapping: the single source of truth for the
// boundary. Both the preload bridge and the main-process IPC registry are typed
// against it, so a typo, a missing channel, OR a swap (mapping a method to a
// valid-but-wrong channel) all fail to compile.
export interface ChannelMap {
  getStatus: "board:getStatus";
  readFile: "board:readFile";
  getDiff: "board:getDiff";
  getFileDiff: "board:getFileDiff";
  archive: "board:archive";
  archivePlan: "board:archivePlan";
  archiveExecute: "board:archiveExecute";
  getSettings: "board:getSettings";
  setSettings: "board:setSettings";
  chooseDirectory: "board:chooseDirectory";
  openPath: "board:openPath";
  openFile: "board:openFile";
  install: "board:install";
  doctor: "board:doctor";
}

export type Channel = ChannelMap[keyof ChannelMap];

// Main → renderer push channels (webContents.send). Unlike the invoke channels
// above these carry no payload and expect no reply; the renderer subscribes via
// the ElectronAPI surface. notificationSound tells the renderer to play the
// bundled completion sound, fired only when a banner is shown with sound.
export interface EventChannelMap {
  notificationSound: "board:notificationSound";
}

export type EventChannel = EventChannelMap[keyof EventChannelMap];

// The surface preload exposes on window.electronAPI; declared onto Window in the
// renderer's global.d.ts so components get typed access rather than `any`.
export interface ElectronAPI {
  getStatus(): Promise<StatusResult>;
  readFile(filePath: string): Promise<ReadFileResult>;
  getDiff(repoPath: string): Promise<DiffResult>;
  getFileDiff(repoPath: string, filePath: string): Promise<DiffResult>;
  archive(payload: ArchiveArgs): Promise<ArchiveResult>;
  // Compute what archiving a change would do to its worktree (for the single
  // confirmation), and execute an archive-with-teardown carrying the acceptances.
  archivePlan(payload: ArchiveArgs): Promise<TeardownPlan>;
  archiveExecute(payload: ArchiveExecuteArgs): Promise<ArchiveExecuteResult>;
  getSettings(): Promise<BoardSettings>;
  setSettings(payload: SetSettingsArgs): Promise<SetSettingsResult>;
  chooseDirectory(): Promise<ChooseDirectoryResult>;
  openPath(target: string): Promise<OpenPathResult>;
  // Open a file that appears in a repo's branch diff in the OS-default editor.
  // filePath is the diff's top-level-relative path; the main process resolves it
  // against the repo's git top-level and guards containment (see openRepoFile).
  openFile(repoPath: string, filePath: string): Promise<OpenPathResult>;
  onNotificationSound(handler: () => void): () => void;
  install(payload: InstallArgs): Promise<InstallResult>;
  doctor(payload: DoctorArgs): Promise<DoctorResult>;
}
