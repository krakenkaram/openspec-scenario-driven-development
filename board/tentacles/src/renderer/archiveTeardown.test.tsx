import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { TeardownPlan } from "../shared/ipc-contract";
import { makeChange, makeStatus, mockApi, selectRepo } from "./test-fixtures";

const teardownPlan: TeardownPlan = {
  applies: true,
  isPrimary: false,
  worktreePath: "/Code/repo-a-wt-z",
  branch: "feat/z",
  branchMerged: false,
  dirty: true,
  warnings: [
    '"tear-me" is the last change in this worktree — the worktree will be removed.',
    'Branch "feat/z" is not merged; deleting it will lose its unmerged commits.',
    "Uncommitted or untracked changes in the worktree will be lost.",
  ],
};

describe("archive with worktree teardown — single informed confirmation", () => {
  beforeEach(() => {
    localStorage.clear();
    selectRepo();
  });
  afterEach(() => vi.restoreAllMocks());

  it("declining the single confirmation performs no archive or teardown", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const c = makeChange({ change: "tear-me", repoPath: "/Code/repo-a" });
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c])),
      archivePlan: vi.fn().mockResolvedValue(teardownPlan),
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("tear-me");
    await user.click(screen.getByText("Archive"));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    const message = String(confirmSpy.mock.calls[0]?.[0]);
    for (const w of teardownPlan.warnings) expect(message).toContain(w);

    expect(api.archivePlan).toHaveBeenCalledWith({ repoPath: "/Code/repo-a", change: "tear-me" });
    expect(api.archiveExecute).not.toHaveBeenCalled();
    expect(api.archive).not.toHaveBeenCalled();
    expect(screen.getByText("tear-me")).toBeInTheDocument();
  });

  it("accepting the single confirmation executes archive+teardown once with the implied acceptances", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const c = makeChange({ change: "tear-me", repoPath: "/Code/repo-a" });
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c])),
      archivePlan: vi.fn().mockResolvedValue(teardownPlan),
      archiveExecute: vi.fn().mockResolvedValue({ archived: true, worktreeRemoved: true, branchDeleted: true }),
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("tear-me");
    await user.click(screen.getByText("Archive"));

    await waitFor(() => expect(api.archiveExecute).toHaveBeenCalledTimes(1));
    expect(api.archiveExecute).toHaveBeenCalledWith({
      repoPath: "/Code/repo-a",
      change: "tear-me",
      acceptUnmerged: true,
      acceptDirty: true,
    });
    // No second dialog: the one confirmation authorised the whole teardown.
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(api.archive).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("tear-me")).toBeNull());
  });
});

describe("archive with worktree teardown — primary reason and partial outcomes", () => {
  beforeEach(() => {
    localStorage.clear();
    selectRepo();
  });
  afterEach(() => vi.restoreAllMocks());

  it("tells the user the primary worktree is kept because it is the primary checkout", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const c = makeChange({ change: "last-prim", repoPath: "/Code/repo-a" });
    const primaryPlan: TeardownPlan = {
      applies: false,
      keptReason: "primary",
      isPrimary: true,
      worktreePath: "/Code/repo-a",
      branch: "master",
      branchMerged: true,
      dirty: false,
      warnings: [],
    };
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c])),
      archivePlan: vi.fn().mockResolvedValue(primaryPlan),
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("last-prim");
    await user.click(screen.getByText("Archive"));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(String(confirmSpy.mock.calls[0]?.[0])).toMatch(/primary checkout/i);
    // Plain archive path (the worktree is kept), never the teardown execute.
    await waitFor(() => expect(api.archive).toHaveBeenCalledWith({ repoPath: "/Code/repo-a", change: "last-prim" }));
    expect(api.archiveExecute).not.toHaveBeenCalled();
  });

  it("surfaces a replanned branch-not-deleted outcome instead of reporting silent success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const c = makeChange({ change: "tear-me", repoPath: "/Code/repo-a" });
    // Plan shown as merged (so the renderer sends acceptUnmerged:false)...
    const plan: TeardownPlan = {
      applies: true,
      isPrimary: false,
      worktreePath: "/Code/repo-a-wt",
      branch: "feat/z",
      branchMerged: true,
      dirty: false,
      warnings: ['"tear-me" is the last change in this worktree — the worktree will be removed.'],
    };
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c])),
      archivePlan: vi.fn().mockResolvedValue(plan),
      // ...but the execute-time replan found it unmerged and safely kept the branch.
      archiveExecute: vi.fn().mockResolvedValue({
        archived: true,
        worktreeRemoved: true,
        branchDeleted: false,
        branchError: "skipped: unmerged branch not accepted",
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("tear-me");
    await user.click(screen.getByText("Archive"));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(String(alertSpy.mock.calls[0]?.[0])).toMatch(/branch was not deleted/i);
  });
});
