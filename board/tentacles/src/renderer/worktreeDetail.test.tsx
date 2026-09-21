import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { makeChange, makeStatus, mockApi } from "./test-fixtures";

beforeEach(() => localStorage.clear());

function expand(repositoryId: string) {
  localStorage.setItem("osb-expanded", JSON.stringify([repositoryId]));
}

describe("worktree-detail view: change chain(s) above the branch diff", () => {
  it("shows one change card above the diff for a single-change worktree", async () => {
    const c = makeChange({ change: "solo-change", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", branch: "feat/solo" });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    // one change card, and the inline diff, both in the main panel
    expect(screen.getByText("solo-change", { selector: ".cname" })).toBeInTheDocument();
    expect(document.querySelectorAll(".worktree-detail .change")).toHaveLength(1);
    expect(document.querySelector(".worktree-detail .diff-panel")).not.toBeNull();
  });

  it("shows two change cards above a single diff for a two-change worktree", async () => {
    const c1 = makeChange({ change: "change-one", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "feat/x" });
    const c2 = makeChange({ change: "change-two", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "feat/x" });
    expand("/Code/r/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c1, c2], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/wt-x"));

    expect(screen.getByText("change-one", { selector: ".cname" })).toBeInTheDocument();
    expect(screen.getByText("change-two", { selector: ".cname" })).toBeInTheDocument();
    expect(document.querySelectorAll(".worktree-detail .change")).toHaveLength(2);
    // exactly ONE branch diff for the whole worktree, not one per change
    expect(document.querySelectorAll(".diff-panel")).toHaveLength(1);
  });
});
