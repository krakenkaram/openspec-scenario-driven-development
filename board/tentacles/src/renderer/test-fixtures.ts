import { vi } from "vitest";
import type { Change, ElectronAPI, Phase, PlanTurn, StatusResult } from "../shared/ipc-contract";

export function phase(id: Phase["id"], over: Partial<Phase> = {}): Phase {
  return { id, applicable: true, done: false, files: [], fileExists: false, ...over };
}

export function makeChange(over: Partial<Change> = {}): Change {
  return {
    change: "my-change",
    repo: "repo-a",
    repoPath: "/Code/repo-a",
    schema: "atdd-driven",
    type: "feature",
    phases: [
      phase("grill"),
      phase("proposal"),
      phase("specs"),
      phase("design"),
      phase("tasks"),
    ],
    apply: { source: "tasks.md", total: 0, done: 0, file: null },
    applyDone: false,
    applying: false,
    review: "none",
    planningComplete: false,
    complete: false,
    pr: null,
    repositoryId: "/Code/repo-a/.git",
    repositoryName: "repo-a",
    branch: null,
    isPrimary: true,
    ...over,
  };
}

export function makeStatus(changes: Change[], repoCount = 1): StatusResult {
  return { generatedAt: "2026-01-01T00:00:00.000Z", repoCount, changes };
}

// The default repositoryId produced by makeChange; the change cards for a repo
// only render once that repository is the active sidebar Selection.
export const DEFAULT_REPO_ID = "/Code/repo-a/.git";

// Seed a repo Selection (and expand it) in localStorage before render, so a
// test that asserts change-card / artifact behaviour sees the cards in the main
// panel under the new selection-scoped layout.
export function selectRepo(repositoryId: string = DEFAULT_REPO_ID) {
  localStorage.setItem("osb-selection", JSON.stringify({ kind: "repo", repositoryId }));
  localStorage.setItem("osb-expanded", JSON.stringify([repositoryId]));
}

export type MockApi = {
  getStatus: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  getDiff: ReturnType<typeof vi.fn>;
  getFileDiff: ReturnType<typeof vi.fn>;
  archive: ReturnType<typeof vi.fn>;
  archivePlan: ReturnType<typeof vi.fn>;
  archiveExecute: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
  setSettings: ReturnType<typeof vi.fn>;
  chooseDirectory: ReturnType<typeof vi.fn>;
  openPath: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
  onNotificationSound: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  doctor: ReturnType<typeof vi.fn>;
  listSchemas: ReturnType<typeof vi.fn>;
  installSchema: ReturnType<typeof vi.fn>;
  uninstallSchema: ReturnType<typeof vi.fn>;
  openSchemaFile: ReturnType<typeof vi.fn>;
  startPlanSession: ReturnType<typeof vi.fn>;
  sendPlanTurn: ReturnType<typeof vi.fn>;
  openTicket: ReturnType<typeof vi.fn>;
  planChooseFolder: ReturnType<typeof vi.fn>;
  newRefinement: ReturnType<typeof vi.fn>;
  onPlanTurn: ReturnType<typeof vi.fn>;
  onPlanSessionEnded: ReturnType<typeof vi.fn>;
};

export function mockApi(over: Partial<ElectronAPI> = {}): MockApi {
  const api = {
    getStatus: vi.fn().mockResolvedValue(makeStatus([])),
    readFile: vi.fn().mockResolvedValue({ ok: true, contents: "" }),
    getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
    getFileDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
    archive: vi.fn().mockResolvedValue({ ok: true }),
    archivePlan: vi.fn().mockResolvedValue({
      applies: false,
      keptReason: "primary",
      isPrimary: true,
      worktreePath: "/Code/repo-a",
      branch: null,
      branchMerged: false,
      dirty: false,
      warnings: [],
    }),
    archiveExecute: vi.fn().mockResolvedValue({ archived: true, worktreeRemoved: null, branchDeleted: null }),
    getSettings: vi.fn().mockResolvedValue({ root: "/Code", notifications: "enabled", targets: [] }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, root: "/Code", notifications: "enabled", targets: [] }),
    chooseDirectory: vi.fn().mockResolvedValue({ path: null }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    openFile: vi.fn().mockResolvedValue({ ok: true }),
    onNotificationSound: vi.fn().mockReturnValue(() => {}),
    install: vi.fn().mockResolvedValue({ steps: [] }),
    doctor: vi.fn().mockResolvedValue({ checks: [] }),
    listSchemas: vi.fn().mockResolvedValue([]),
    installSchema: vi.fn().mockResolvedValue({ ok: true }),
    uninstallSchema: vi.fn().mockResolvedValue({ ok: true }),
    openSchemaFile: vi.fn().mockResolvedValue({ ok: true }),
    startPlanSession: vi.fn().mockResolvedValue({ ok: true }),
    sendPlanTurn: vi.fn().mockResolvedValue({ ok: true }),
    openTicket: vi.fn().mockResolvedValue({ ok: true }),
    planChooseFolder: vi.fn().mockResolvedValue({ path: null }),
    newRefinement: vi.fn().mockResolvedValue({ ok: true }),
    onPlanTurn: vi.fn().mockReturnValue(() => {}),
    onPlanSessionEnded: vi.fn().mockReturnValue(() => {}),
    ...over,
  } as unknown as MockApi;
  (window as unknown as { electronAPI: ElectronAPI }).electronAPI = api as unknown as ElectronAPI;
  return api;
}

// A scriptable fake for the planTurn push channel: pass `onPlanTurn` into
// mockApi, then call `emit(turn)` to push a turn to whatever handler the app
// registered. Mirrors the onNotificationSound capture pattern.
export function planTurnChannel() {
  let handler: ((turn: PlanTurn) => void) | undefined;
  const unsubscribe = vi.fn();
  const onPlanTurn = vi.fn((cb: (turn: PlanTurn) => void) => {
    handler = cb;
    return unsubscribe;
  });
  return {
    onPlanTurn,
    unsubscribe,
    emit(turn: PlanTurn) {
      handler?.(turn);
    },
  };
}

// A scriptable fake for the planSessionEnded push channel: pass `onPlanSessionEnded`
// into mockApi, then call `end()` to fire the terminal signal at the app's handler.
export function planSessionEndedChannel() {
  let handler: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const onPlanSessionEnded = vi.fn((cb: () => void) => {
    handler = cb;
    return unsubscribe;
  });
  return {
    onPlanSessionEnded,
    unsubscribe,
    end() {
      handler?.();
    },
  };
}
