import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { makeChange, makeStatus, mockApi, phase, selectRepo } from "./test-fixtures";

// The cards for a repo render only when that repo is the active sidebar
// Selection, so seed the default repo selection before each test. Tests that
// exercise a different repo re-seed it before rendering.
beforeEach(() => {
  localStorage.clear();
  selectRepo();
});

describe("the renderer renders the board state", () => {
  it("lists repositories in the sidebar and orders the selected repo's cards", async () => {
    const incomplete = makeChange({ change: "a-incomplete", repo: "repo-a", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", repositoryName: "repo-a", type: "feature", complete: false });
    const complete = makeChange({ change: "z-complete", repo: "repo-a", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", repositoryName: "repo-a", type: "refactor", complete: true, review: "passed" });
    const other = makeChange({ change: "b-other", repo: "repo-b", repoPath: "/Code/repo-b", repositoryId: "/Code/repo-b/.git", repositoryName: "repo-b" });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([complete, incomplete, other], 2)) });

    const { container } = render(<App />);
    await screen.findByText("repo-a", { selector: ".sb-repo-name" });

    // the sidebar lists both repositories in name order
    const repoNames = [...document.querySelectorAll(".sb-repo-name")].map((e) => e.textContent);
    expect(repoNames).toEqual(["repo-a", "repo-b"]);

    // repo-a is the seeded selection: only its cards show, incomplete before complete
    const names = [...container.querySelectorAll(".cname")].map((e) => e.textContent);
    expect(names).toEqual(["a-incomplete", "z-complete"]);
    expect(screen.getByText("2 change(s) · 1 complete")).toBeInTheDocument();
    // none of repo-b's changes are in the main panel
    expect(screen.queryByText("b-other")).toBeNull();

    // badges of the visible (repo-a) cards
    expect(screen.getAllByText("FEATURE")).toHaveLength(1);
    expect(screen.getByText("REFACTOR")).toBeInTheDocument();
    expect(screen.getByText("COMPLETE")).toBeInTheDocument();
  });

  it("shows a branch chip per card only when worktrees are grouped (nested)", async () => {
    const featA = makeChange({
      change: "feat-a-change", repo: "wings-core-a", repoPath: "/Code/wings-core-a",
      repositoryId: "/Code/wings-core/.git", repositoryName: "wings-core", branch: "feat-a",
    });
    const featB = makeChange({
      change: "feat-b-change", repo: "wings-core-b", repoPath: "/Code/wings-core-b",
      repositoryId: "/Code/wings-core/.git", repositoryName: "wings-core", branch: "feat-b",
    });
    const solo = makeChange({
      change: "solo-change", repo: "lonely", repoPath: "/Code/lonely",
      repositoryId: "/Code/lonely/.git", repositoryName: "lonely", branch: "feat-solo",
    });
    selectRepo("/Code/wings-core/.git");
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([featA, featB, solo], 2)) });

    const { container } = render(<App />);
    await screen.findByText("feat-a-change");

    // both concurrent worktrees (wings-core selected) show their branch chip
    const chips = [...container.querySelectorAll(".branch-chip")].map((e) => e.textContent);
    expect(chips).toContain("feat-a");
    expect(chips).toContain("feat-b");
  });

  it("shows no branch chip for a lone worktree repository", async () => {
    const solo = makeChange({
      change: "solo-change", repo: "lonely", repoPath: "/Code/lonely",
      repositoryId: "/Code/lonely/.git", repositoryName: "lonely", branch: "feat-solo",
    });
    selectRepo("/Code/lonely/.git");
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([solo], 1)) });

    render(<App />);
    await screen.findByText("solo-change");

    const soloCard = screen.getByText("solo-change").closest(".change");
    expect(soloCard?.querySelector(".branch-chip")).toBeNull();
  });

  it("renders each phase's state in the chain", async () => {
    const c = makeChange({
      change: "phases-demo",
      phases: [
        phase("grill", { done: true, files: ["/g.md"] }),
        phase("proposal", { inProgress: true }),
        phase("specs", { applicable: false }),
        phase("design"),
      ],
    });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });

    render(<App />);
    await screen.findByText("phases-demo");

    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByText("✓ done")).toBeInTheDocument();

    // the done phase with a file is clickable
    const grillNode = screen.getByText("grill").closest(".node");
    expect(grillNode?.className).toContain("clickable");
  });

  it("makes an in-progress phase clickable when its artifact is on disk and opens it", async () => {
    const c = makeChange({
      change: "inprogress-openable",
      phases: [
        phase("grill", { done: true, files: ["/repo/x/grill.md"] }),
        // proposal.md exists but the phase is still in-progress (done keys on the
        // next artifact) — it must be openable.
        phase("proposal", { inProgress: true, fileExists: true, files: ["/repo/x/proposal.md"] }),
        phase("specs"),
        phase("design"),
        phase("tasks"),
      ],
    });
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c])),
      readFile: vi.fn().mockResolvedValue({ ok: true, contents: "proposal body" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("inprogress-openable");

    const proposalNode = screen.getByText("proposal").closest(".node");
    expect(proposalNode?.className).toContain("clickable");

    await user.click(screen.getByText("proposal"));
    expect(api.readFile).toHaveBeenCalledWith("/repo/x/proposal.md");
  });

  it("keeps an in-progress phase non-clickable when its artifact is not yet on disk", async () => {
    const c = makeChange({
      change: "inprogress-empty",
      phases: [
        phase("grill", { done: true, files: ["/repo/x/grill.md"] }),
        phase("proposal", { inProgress: true, fileExists: false, files: ["/repo/x/proposal.md"] }),
        phase("specs"),
        phase("design"),
        phase("tasks"),
      ],
    });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });

    render(<App />);
    await screen.findByText("inprogress-empty");

    const proposalNode = screen.getByText("proposal").closest(".node");
    expect(proposalNode?.className).not.toContain("clickable");
  });

  it("shows apply progress on the apply node without a redundant progress bar", async () => {
    const c = makeChange({
      change: "tasks-apply",
      planningComplete: true,
      applying: true,
      apply: { source: "tasks.md", total: 4, done: 2, file: "/t.md" },
    });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });

    const { container } = render(<App />);
    await screen.findByText("tasks-apply");

    // the apply node still carries the x/y count
    expect(screen.getByText("2/4")).toBeInTheDocument();
    // but the redundant horizontal progress bar is gone
    expect(container.querySelector(".apply")).toBeNull();
    expect(container.querySelector(".bar")).toBeNull();
    expect(screen.queryByText("apply progress")).toBeNull();
  });

  it("shows commit-source apply on the apply node without a progress bar", async () => {
    const c = makeChange({
      change: "commits-apply",
      planningComplete: true,
      applying: true,
      apply: { source: "commits", total: 3, done: null, commits: 5, file: "/t.md" },
    });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });

    const { container } = render(<App />);
    await screen.findByText("commits-apply");

    // the apply node carries the commit count
    expect(screen.getByText("5 commit(s)")).toBeInTheDocument();
    // no bar and no "tasks.md not ticked" footer any more
    expect(container.querySelector(".apply")).toBeNull();
    expect(screen.queryByText(/tasks\.md not ticked/)).toBeNull();
  });

  it("reveals the worktree folder in the OS file browser when View in Finder is clicked", async () => {
    const openPath = vi.fn().mockResolvedValue({ ok: true });
    const c = makeChange({ change: "finder-change", repoPath: "/Code/wings-core-a" });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])), openPath });

    render(<App />);
    await screen.findByText("finder-change");

    const card = screen.getByText("finder-change").closest(".change") as HTMLElement;
    const btn = within(card).getByRole("button", { name: /view in finder/i });
    btn.click();

    expect(openPath).toHaveBeenCalledWith("/Code/wings-core-a");
  });

  it("surfaces the OS error when View in Finder fails to open the folder", async () => {
    const openPath = vi.fn().mockResolvedValue({ ok: false, error: "no such file or directory" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const c = makeChange({ change: "finder-fail", repoPath: "/Code/gone" });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])), openPath });

    render(<App />);
    await screen.findByText("finder-fail");

    const card = screen.getByText("finder-fail").closest(".change") as HTMLElement;
    within(card).getByRole("button", { name: /view in finder/i }).click();

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("Could not open folder: no such file or directory")
    );
    alertSpy.mockRestore();
  });

  it("renders the review and done nodes reflecting review and PR state", async () => {
    const merged = makeChange({
      change: "merged-change",
      complete: true,
      review: "passed",
      planningComplete: true,
      pr: { url: "https://github.com/o/r/pull/9", number: 9, state: "MERGED", reviewDecision: "APPROVED", isDraft: false },
    });
    const noPr = makeChange({ change: "nopr-change", repo: "repo-a", repoPath: "/Code/repo-a" });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([merged, noPr])) });

    render(<App />);
    await screen.findByText("merged-change");

    // approved appears only on the review node (once), not duplicated on done
    expect(screen.getAllByText("✓ Agent Approved")).toHaveLength(1);

    const prLink = screen.getByRole("link", { name: /PR ↗/ });
    expect(prLink).toHaveAttribute("href", "https://github.com/o/r/pull/9");
    expect(within(prLink).getByText("PR ↗ ✓ merged")).toBeInTheDocument();

    // a change with no PR shows a "no PR" done node
    expect(screen.getByText("· no PR")).toBeInTheDocument();
  });

  it("marks the apply node clickable (pointer) whenever it opens an artifact, even while applying", async () => {
    const c = makeChange({
      change: "apply-clickable",
      planningComplete: true,
      applying: true,
      apply: { source: "tasks.md", total: 4, done: 1, file: "/tasks.md" },
    });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });

    render(<App />);
    await screen.findByText("apply-clickable");

    const applyNode = screen.getByText("apply").closest(".node");
    expect(applyNode?.className).toContain("clickable");
  });

  it("renders a PR button labelled #<number> next to View in Finder that links to the PR", async () => {
    const c = makeChange({
      change: "pr-button-change",
      repoPath: "/Code/repo-a",
      pr: { url: "https://github.com/o/r/pull/42", number: 42, state: "OPEN", reviewDecision: "", isDraft: false },
    });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });

    render(<App />);
    await screen.findByText("pr-button-change");

    const card = screen.getByText("pr-button-change").closest(".change") as HTMLElement;
    const prBtn = within(card).getByRole("link", { name: /#42/ });
    expect(prBtn).toHaveAttribute("href", "https://github.com/o/r/pull/42");
    expect(prBtn.className).toContain("pr-btn");
  });

  it("shows no PR button on the card when the change has no PR", async () => {
    const c = makeChange({ change: "no-pr-button", repoPath: "/Code/repo-a", pr: null });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });

    render(<App />);
    await screen.findByText("no-pr-button");

    const card = screen.getByText("no-pr-button").closest(".change") as HTMLElement;
    expect(card.querySelector(".pr-btn")).toBeNull();
  });
});
