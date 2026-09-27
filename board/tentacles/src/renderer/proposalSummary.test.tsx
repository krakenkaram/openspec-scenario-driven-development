import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { makeChange, makeStatus, mockApi, phase } from "./test-fixtures";

beforeEach(() => localStorage.clear());

function expand(repositoryId: string) {
  localStorage.setItem("osb-expanded", JSON.stringify([repositoryId]));
}

// A Change whose proposal PHASE is complete: its `proposal` phase is done
// (ADR-0004: the next artifact, specs.md, exists) and carries the proposal path.
function doneProposalChange(over: Parameters<typeof makeChange>[0] & { proposalPath: string }) {
  const { proposalPath, ...rest } = over;
  return makeChange({
    phases: [
      phase("grill", { done: true }),
      phase("proposal", { done: true, fileExists: true, files: [proposalPath] }),
      phase("specs", { fileExists: true }),
      phase("design"),
      phase("tasks"),
    ],
    ...rest,
  });
}

describe("proposal summary above the branch diff", () => {
  it("shows a completed proposal's Problem Statement and Why between the card and the diff", async () => {
    const proposalPath = "/Code/repo-a/openspec/changes/solo/proposal.md";
    const c = doneProposalChange({
      change: "solo",
      repoPath: "/Code/repo-a",
      repositoryId: "/Code/repo-a/.git",
      branch: "feat/solo",
      proposalPath,
    });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockResolvedValue({
        ok: true,
        contents:
          "## Problem Statement\n\nUsers cannot see why a diff exists.\n\n## Why\n\nIntent is the missing caption for the diff.\n\n## What Changes\n\n- add the block\n",
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    // the two sections' text is shown (waits for the async readFile)
    expect(await screen.findByText("Users cannot see why a diff exists.")).toBeInTheDocument();
    expect(screen.getByText("Intent is the missing caption for the diff.")).toBeInTheDocument();

    const block = document.querySelector("[data-proposal-summary]");
    expect(block).not.toBeNull();

    const card = screen.getByRole("heading", { level: 2, name: "solo" });
    const diff = document.querySelector(".worktree-detail .diff-panel");
    expect(diff).not.toBeNull();

    // the block sits AFTER the change card and BEFORE the branch diff
    expect(card.compareDocumentPosition(block as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((block as Node).compareDocumentPosition(diff as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no block when the proposal phase is not complete", async () => {
    // proposal.md exists but specs.md does not → the proposal phase is NOT done
    const c = makeChange({
      change: "planning",
      repoPath: "/Code/repo-a",
      repositoryId: "/Code/repo-a/.git",
      branch: "feat/planning",
      phases: [
        phase("grill", { done: true }),
        phase("proposal", { done: false, fileExists: true, files: ["/Code/repo-a/openspec/changes/planning/proposal.md"] }),
        phase("specs"),
        phase("design"),
        phase("tasks"),
      ],
    });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockResolvedValue({ ok: true, contents: "## Problem Statement\n\nShould not appear.\n\n## Why\n\nHidden.\n" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    // the card and diff still render
    expect(screen.getByRole("heading", { level: 2, name: "planning" })).toBeInTheDocument();
    expect(document.querySelector(".worktree-detail .diff-panel")).not.toBeNull();
    // but no proposal-summary block, and none of its would-be text
    expect(document.querySelector("[data-proposal-summary]")).toBeNull();
    expect(screen.queryByText("Should not appear.")).toBeNull();
  });

  it("shows only Problem Statement and Why, never the other proposal sections", async () => {
    const proposalPath = "/Code/repo-a/openspec/changes/solo/proposal.md";
    const c = doneProposalChange({
      change: "solo",
      repoPath: "/Code/repo-a",
      repositoryId: "/Code/repo-a/.git",
      proposalPath,
    });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockResolvedValue({
        ok: true,
        contents:
          "## Problem Statement\n\nProblem text here.\n\n## Why\n\nWhy text here.\n\n## What Changes\n\nWHATCHANGES_MARKER\n\n## Capabilities\n\nCAPABILITIES_MARKER\n\n## Impact\n\nIMPACT_MARKER\n",
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    expect(await screen.findByText("Problem text here.")).toBeInTheDocument();
    expect(screen.getByText("Why text here.")).toBeInTheDocument();
    // no text from the excluded sections leaks into the view
    expect(screen.queryByText(/WHATCHANGES_MARKER/)).toBeNull();
    expect(screen.queryByText(/CAPABILITIES_MARKER/)).toBeNull();
    expect(screen.queryByText(/IMPACT_MARKER/)).toBeNull();
  });

  it("merges two completed proposals into one block in change-chain order, with no id labels", async () => {
    const p1 = "/Code/wt-x/openspec/changes/change-one/proposal.md";
    const p2 = "/Code/wt-x/openspec/changes/change-two/proposal.md";
    const c1 = doneProposalChange({ change: "change-one", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", proposalPath: p1 });
    const c2 = doneProposalChange({ change: "change-two", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", proposalPath: p2 });
    expand("/Code/r/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c1, c2], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockImplementation(async (fp: string) => {
        if (fp === p1) return { ok: true, contents: "## Problem Statement\n\nPROBLEM_ONE\n\n## Why\n\nWHY_ONE\n" };
        if (fp === p2) return { ok: true, contents: "## Problem Statement\n\nPROBLEM_TWO\n\n## Why\n\nWHY_TWO\n" };
        return { ok: false, error: "not found" };
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/wt-x"));

    // exactly one block, containing both proposals
    await screen.findByText("PROBLEM_ONE");
    const blocks = document.querySelectorAll("[data-proposal-summary]");
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as HTMLElement;
    expect(block.textContent).toContain("PROBLEM_ONE");
    expect(block.textContent).toContain("WHY_ONE");
    expect(block.textContent).toContain("PROBLEM_TWO");
    expect(block.textContent).toContain("WHY_TWO");
    // change-chain order: the first change's sections precede the second's
    expect(block.textContent!.indexOf("PROBLEM_ONE")).toBeLessThan(block.textContent!.indexOf("PROBLEM_TWO"));
    // no per-change id labels inside the block
    expect(block.textContent).not.toContain("change-one");
    expect(block.textContent).not.toContain("change-two");
    // one block, still above the single diff
    const diff = document.querySelector(".worktree-detail .diff-panel");
    expect(block.compareDocumentPosition(diff as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("skips a section whose heading is absent entirely, not just blank", async () => {
    const proposalPath = "/Code/repo-a/openspec/changes/solo/proposal.md";
    const c = doneProposalChange({ change: "solo", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", proposalPath });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      // the `## Why` heading is missing from the file altogether
      readFile: vi.fn().mockResolvedValue({ ok: true, contents: "## Problem Statement\n\nA problem with no reason section.\n" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    expect(await screen.findByText("A problem with no reason section.")).toBeInTheDocument();
    const block = document.querySelector("[data-proposal-summary]") as HTMLElement;
    expect(block.textContent).toContain("Problem Statement");
    expect(block.textContent).not.toContain("Why");
  });

  it("shows only Why when the Problem Statement heading is absent", async () => {
    const proposalPath = "/Code/repo-a/openspec/changes/solo/proposal.md";
    const c = doneProposalChange({ change: "solo", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", proposalPath });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      // the `## Problem Statement` heading is missing from the file altogether
      readFile: vi.fn().mockResolvedValue({ ok: true, contents: "## Why\n\nWhy with no Problem heading.\n" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    expect(await screen.findByText("Why with no Problem heading.")).toBeInTheDocument();
    const block = document.querySelector("[data-proposal-summary]") as HTMLElement;
    expect(block.textContent).toContain("Why");
    expect(block.textContent).not.toContain("Problem Statement");
  });

  it("repeats the Problem Statement and Why headings once per contributing proposal", async () => {
    const p1 = "/Code/wt-x/openspec/changes/change-one/proposal.md";
    const p2 = "/Code/wt-x/openspec/changes/change-two/proposal.md";
    const c1 = doneProposalChange({ change: "change-one", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", proposalPath: p1 });
    const c2 = doneProposalChange({ change: "change-two", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", proposalPath: p2 });
    expand("/Code/r/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c1, c2], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockImplementation(async (fp: string) => {
        if (fp === p1) return { ok: true, contents: "## Problem Statement\n\nPROBLEM_ONE\n\n## Why\n\nWHY_ONE\n" };
        if (fp === p2) return { ok: true, contents: "## Problem Statement\n\nPROBLEM_TWO\n\n## Why\n\nWHY_TWO\n" };
        return { ok: false, error: "not found" };
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/wt-x"));

    await screen.findByText("PROBLEM_ONE");
    const block = document.querySelector("[data-proposal-summary]") as HTMLElement;
    // each of the two proposals contributes its own pair of headings (grill Q4: repeat per proposal)
    expect((block.textContent!.match(/Problem Statement/g) || []).length).toBe(2);
    expect((block.textContent!.match(/Why/g) || []).length).toBe(2);
  });

  it("skips an empty Why, showing only the Problem Statement", async () => {
    const proposalPath = "/Code/repo-a/openspec/changes/solo/proposal.md";
    const c = doneProposalChange({ change: "solo", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", proposalPath });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockResolvedValue({ ok: true, contents: "## Problem Statement\n\nOnly a problem.\n\n## Why\n\n\n" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    expect(await screen.findByText("Only a problem.")).toBeInTheDocument();
    const block = document.querySelector("[data-proposal-summary]") as HTMLElement;
    expect(block.textContent).toContain("Problem Statement");
    // the empty Why heading is not rendered
    expect(block.textContent).not.toContain("Why");
  });

  it("drops a proposal with neither section, keeping a filled one", async () => {
    const pEmpty = "/Code/wt-x/openspec/changes/empty-one/proposal.md";
    const pFull = "/Code/wt-x/openspec/changes/full-two/proposal.md";
    const c1 = doneProposalChange({ change: "empty-one", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", proposalPath: pEmpty });
    const c2 = doneProposalChange({ change: "full-two", repoPath: "/Code/wt-x", repositoryId: "/Code/r/.git", repositoryName: "r", proposalPath: pFull });
    expand("/Code/r/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c1, c2], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockImplementation(async (fp: string) => {
        if (fp === pEmpty) return { ok: true, contents: "## Problem Statement\n\n\n\n## Why\n\n\n" };
        if (fp === pFull) return { ok: true, contents: "## Problem Statement\n\nSECOND_PROBLEM\n\n## Why\n\nSECOND_WHY\n" };
        return { ok: false, error: "not found" };
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/wt-x"));

    await screen.findByText("SECOND_PROBLEM");
    const block = document.querySelector("[data-proposal-summary]") as HTMLElement;
    expect(block.textContent).toContain("SECOND_PROBLEM");
    expect(block.textContent).toContain("SECOND_WHY");
    // the empty proposal contributes nothing → exactly one Problem Statement heading
    expect(block.querySelectorAll("*")).not.toHaveLength(0);
    expect((block.textContent!.match(/Problem Statement/g) || []).length).toBe(1);
  });

  it("shows no block when every qualifying proposal is empty", async () => {
    const proposalPath = "/Code/repo-a/openspec/changes/solo/proposal.md";
    const c = doneProposalChange({ change: "solo", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", proposalPath });
    expand("/Code/repo-a/.git");
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)),
      getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }),
      readFile: vi.fn().mockResolvedValue({ ok: true, contents: "## Problem Statement\n\n\n\n## Why\n\n\n" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/repo-a"));

    // the card renders; give any async read a chance to resolve, then assert no block
    expect(await screen.findByRole("heading", { level: 2, name: "solo" })).toBeInTheDocument();
    await Promise.resolve();
    expect(document.querySelector("[data-proposal-summary]")).toBeNull();
  });
});
