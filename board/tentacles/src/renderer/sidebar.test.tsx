import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { makeChange, makeStatus, mockApi, phase } from "./test-fixtures";

beforeEach(() => localStorage.clear());

function expand(repositoryId: string) {
  localStorage.setItem("osb-expanded", JSON.stringify([repositoryId]));
}

// A repository with two distinct worktrees, and a lone-worktree repository.
function twoRepos() {
  const wtA = makeChange({ change: "wc-a", repoPath: "/Code/wc-a", repositoryId: "/Code/wc/.git", repositoryName: "wings-core", branch: "feat-a" });
  const wtB = makeChange({ change: "wc-b", repoPath: "/Code/wc-b", repositoryId: "/Code/wc/.git", repositoryName: "wings-core", branch: "feat-b", isPrimary: false });
  const solo = makeChange({ change: "solo", repoPath: "/Code/lonely", repositoryId: "/Code/lonely/.git", repositoryName: "lonely", branch: "main" });
  return [wtA, wtB, solo];
}

const repoRows = () => [...document.querySelectorAll("[data-repo]")];
const leafRows = () => [...document.querySelectorAll("[data-worktree-leaf]")];
const branchOrder = () => leafRows().map((el) => el.getAttribute("data-branch"));

describe("sidebar lists repositories as expandable rows", () => {
  it("shows one row per repository with a worktree count badge", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");

    expect(repoRows()).toHaveLength(2);
    expect(screen.getByTitle("2 worktree(s)")).toHaveTextContent("2");
    expect(screen.getByTitle("1 worktree(s)")).toHaveTextContent("1");
  });

  it("expands and collapses a repository row to reveal and hide its worktrees", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    const user = userEvent.setup();
    render(<App />);
    const wc = (await screen.findByText("wings-core")).closest("[data-repo]") as HTMLElement;

    // collapsed on cold start → no leaves
    expect(within(wc).queryByText("feat-a")).toBeNull();

    await user.click(within(wc).getByRole("button", { name: /expand repository/i }));
    expect(within(wc).getByText("feat-a")).toBeInTheDocument();
    expect(within(wc).getByText("feat-b")).toBeInTheDocument();

    await user.click(within(wc).getByRole("button", { name: /collapse repository/i }));
    expect(within(wc).queryByText("feat-a")).toBeNull();
  });
});

describe("layout: top bar stays, sidebar is chrome-free, nothing selected shows a prompt", () => {
  it("keeps the top-bar controls and gives the sidebar no chrome of its own", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");

    // top bar controls
    expect(screen.getByText("Tentacles")).toBeInTheDocument();
    expect(screen.getByTitle("Settings")).toBeInTheDocument();
    expect(screen.getByTitle("Toggle dark / light")).toBeInTheDocument();
    expect(screen.getByText(/change\(s\) ·/)).toBeInTheDocument();

    // sidebar carries no title / settings / status strip of its own
    const sidebar = document.querySelector(".sidebar") as HTMLElement;
    expect(sidebar.querySelector("h1")).toBeNull();
    expect(within(sidebar).queryByTitle("Settings")).toBeNull();
    expect(within(sidebar).queryByText(/change\(s\) ·/)).toBeNull();
  });

  it("does not stack all repositories and shows a neutral prompt on cold start", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");

    // no change cards are rendered in the main panel until a selection is made
    expect(document.querySelectorAll("[data-change-card]")).toHaveLength(0);
    expect(screen.getByText(/Select a repository/i)).toBeInTheDocument();
  });
});

describe("repository selection scopes the main panel; chevron vs body", () => {
  it("selecting a repository shows only that repository's changes", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("wings-core"));

    // wings-core's two worktree cards show; lonely's does not
    expect(screen.getByRole("heading", { level: 2, name: "wc-a" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "wc-b" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "solo" })).toBeNull();
  });

  it("clicking the repository body selects it and auto-expands it", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    const user = userEvent.setup();
    render(<App />);
    const wc = (await screen.findByText("wings-core")).closest("[data-repo]") as HTMLElement;

    expect(within(wc).queryByText("feat-a")).toBeNull(); // collapsed
    await user.click(screen.getByText("wings-core"));

    expect(wc.getAttribute("aria-current")).toBe("true"); // selected
    expect(within(wc).getByText("feat-a")).toBeInTheDocument(); // auto-expanded
    expect(screen.getByRole("heading", { level: 2, name: "wc-a" })).toBeInTheDocument(); // main scoped to it
  });

  it("the chevron toggles expansion only, leaving the selection unchanged", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("wings-core");

    // select lonely first
    await user.click(screen.getByText("lonely"));
    expect(screen.getByRole("heading", { level: 2, name: "solo" })).toBeInTheDocument();

    // expand wings-core via its chevron — selection must stay on lonely
    const wc = screen.getByText("wings-core").closest("[data-repo]") as HTMLElement;
    await user.click(within(wc).getByRole("button", { name: /expand repository/i }));

    expect(within(wc).getByText("feat-a")).toBeInTheDocument(); // expanded
    expect(wc.getAttribute("aria-current")).not.toBe("true"); // not selected
    expect(screen.getByRole("heading", { level: 2, name: "solo" })).toBeInTheDocument(); // lonely still the selection
  });
});

describe("worktree leaf composition", () => {
  it("shows branch title and directory basename, and never renders a primary pill", async () => {
    const primary = makeChange({ change: "p", repoPath: "/Code/acme", repositoryId: "/Code/acme/.git", repositoryName: "acme", branch: "main", isPrimary: true });
    const linked = makeChange({ change: "l", repoPath: "/Code/acme-feat-x", repositoryId: "/Code/acme/.git", repositoryName: "acme", branch: "feat/x", isPrimary: false });
    expand("/Code/acme/.git");
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([primary, linked], 1)) });
    render(<App />);
    await screen.findByText("feat/x");

    const primaryLeaf = screen.getByText("main").closest("[data-worktree-leaf]") as HTMLElement;
    const linkedLeaf = screen.getByText("feat/x").closest("[data-worktree-leaf]") as HTMLElement;

    expect(within(primaryLeaf).getByText("acme")).toBeInTheDocument();
    expect(within(linkedLeaf).getByText("acme-feat-x")).toBeInTheDocument();
    // The "primary" pill is gone from every row.
    expect(screen.queryByText(/primary/i)).toBeNull();
  });

  it("still sorts the primary checkout first even though it is no longer labelled", async () => {
    const primary = makeChange({ change: "p", repoPath: "/Code/acme", repositoryId: "/Code/acme/.git", repositoryName: "acme", branch: "main", isPrimary: true });
    const linked = makeChange({ change: "l", repoPath: "/Code/acme-feat-x", repositoryId: "/Code/acme/.git", repositoryName: "acme", branch: "feat/x", isPrimary: false });
    expand("/Code/acme/.git");
    // scrambled input order: linked first
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([linked, primary], 1)) });
    render(<App />);
    await screen.findByText("feat/x");

    expect(branchOrder()).toEqual(["main", "feat/x"]);
  });
});

const CHANGES_REQUESTED_PR = { url: "u", number: 1, state: "OPEN", reviewDecision: "CHANGES_REQUESTED", isDraft: false };

describe("per-worktree status indicator (four states, least-done-wins)", () => {
  function leafFor(changes: ReturnType<typeof makeChange>[]) {
    expand("/Code/repo-a/.git");
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(changes, 1)) });
  }
  const statusOf = (el: HTMLElement) => el.querySelector("[data-status]")?.getAttribute("data-status");

  it("renders a green tick when all changes are complete", async () => {
    leafFor([makeChange({ change: "done1", repoPath: "/Code/repo-a", complete: true })]);
    render(<App />);
    const el = await waitForLeaf();
    expect(statusOf(el)).toBe("completed");
  });

  it("renders the in-progress spinner when a change is applying", async () => {
    leafFor([makeChange({ change: "app1", repoPath: "/Code/repo-a", applying: true, complete: false })]);
    render(<App />);
    const el = await waitForLeaf();
    expect(statusOf(el)).toBe("in-progress");
  });

  it("renders a red circle when a change's PR has requested changes (blocked)", async () => {
    leafFor([makeChange({ change: "blk1", repoPath: "/Code/repo-a", complete: false, pr: CHANGES_REQUESTED_PR })]);
    render(<App />);
    const el = await waitForLeaf();
    expect(statusOf(el)).toBe("blocked");
  });

  it("renders the grey idle dot when nothing is active, blocked, or complete", async () => {
    leafFor([makeChange({ change: "idle1", repoPath: "/Code/repo-a", complete: false })]);
    render(<App />);
    const el = await waitForLeaf();
    expect(statusOf(el)).toBe("idle");
  });

  it("precedence: blocked wins over in-progress", async () => {
    leafFor([
      makeChange({ change: "c-applying", repoPath: "/Code/repo-a", complete: false, applying: true }),
      makeChange({ change: "c-blocked", repoPath: "/Code/repo-a", complete: false, pr: CHANGES_REQUESTED_PR }),
    ]);
    render(<App />);
    const el = await waitForLeaf();
    expect(statusOf(el)).toBe("blocked");
  });

  it("precedence: in-progress wins over completed (least-done-wins)", async () => {
    leafFor([
      makeChange({ change: "c-done", repoPath: "/Code/repo-a", complete: true }),
      makeChange({ change: "c-applying", repoPath: "/Code/repo-a", complete: false, applying: true }),
    ]);
    render(<App />);
    const el = await waitForLeaf();
    expect(statusOf(el)).toBe("in-progress");
  });
});

describe("completed worktree row is de-emphasised", () => {
  it("marks a completed leaf row and leaves an idle row unmarked", async () => {
    expand("/Code/r/.git");
    const done = makeChange({ change: "d", repoPath: "/Code/w-done", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "wt-done", complete: true });
    const idle = makeChange({ change: "i", repoPath: "/Code/w-idle", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "wt-idle", complete: false });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([done, idle], 1)) });
    render(<App />);
    await screen.findByText("r");

    const doneLeaf = screen.getByText("wt-done").closest("[data-worktree-leaf]") as HTMLElement;
    const idleLeaf = screen.getByText("wt-idle").closest("[data-worktree-leaf]") as HTMLElement;
    expect(doneLeaf.getAttribute("data-completed")).toBe("true");
    expect(idleLeaf.getAttribute("data-completed")).toBeNull();
  });
});

describe("worktree leaves are ordered by attention tier", () => {
  it("sorts waiting-on-human, then agent-active, then done, then idle", async () => {
    const idle = makeChange({ change: "i", repoPath: "/Code/w-idle", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "wt-idle", complete: false });
    const done = makeChange({ change: "d", repoPath: "/Code/w-done", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "wt-done", complete: true });
    const active = makeChange({ change: "a", repoPath: "/Code/w-active", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "wt-active", applying: true });
    const human = makeChange({
      change: "h", repoPath: "/Code/w-human", repositoryId: "/Code/r/.git", repositoryName: "r", branch: "wt-human",
      pr: { url: "u", number: 1, state: "OPEN", reviewDecision: "CHANGES_REQUESTED", isDraft: false },
    });
    expand("/Code/r/.git");
    // deliberately scrambled input order
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([idle, done, active, human], 1)) });
    render(<App />);
    await screen.findByText("r");

    expect(branchOrder()).toEqual(["wt-human", "wt-active", "wt-done", "wt-idle"]);
  });
});

describe("selection and expansion persist; cold start and stale target", () => {
  it("restores a persisted expansion and worktree selection on mount", async () => {
    const c = makeChange({ change: "persisted", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git", branch: "main-branch" });
    localStorage.setItem("osb-expanded", JSON.stringify(["/Code/repo-a/.git"]));
    localStorage.setItem("osb-selection", JSON.stringify({ kind: "worktree", repoPath: "/Code/repo-a" }));
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)), getDiff: vi.fn().mockResolvedValue({ ok: true, files: [] }) });
    render(<App />);
    await screen.findByText("main-branch");

    // repo expanded (leaf visible) and worktree selected (leaf highlighted + diff panel shown)
    expect(document.querySelector('[data-worktree-leaf][aria-current="true"]')).not.toBeNull();
    expect(await screen.findByText(/Branch diff —/)).toBeInTheDocument();
  });

  it("falls back to the neutral state when the persisted selection no longer exists", async () => {
    const c = makeChange({ change: "here", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git" });
    localStorage.setItem("osb-selection", JSON.stringify({ kind: "worktree", repoPath: "/Code/gone" }));
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)) });
    render(<App />);
    await screen.findByText(/Select a repository/i);

    expect(document.querySelector('[data-worktree-leaf][aria-current="true"]')).toBeNull();
    expect(document.querySelector(".diff-panel")).toBeNull();
  });
});

function waitForLeaf(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector("[data-worktree-leaf]");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

describe("the sidebar width is draggable within bounds", () => {
  function drag(fromX: number, toX: number) {
    const handle = document.querySelector(".sb-resize") as HTMLElement;
    expect(handle).not.toBeNull();
    fireEvent.mouseDown(handle, { clientX: fromX });
    fireEvent.mouseMove(window, { clientX: toX });
    fireEvent.mouseUp(window, { clientX: toX });
  }

  it("widens the sidebar when the handle is dragged to the right", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");
    const sidebar = document.querySelector(".sidebar") as HTMLElement;

    const before = parseInt(sidebar.style.width, 10);
    expect(before).toBe(264);

    drag(0, 120);
    expect(parseInt(sidebar.style.width, 10)).toBe(384);
  });

  it("clamps the sidebar at its 180px minimum on a large leftward drag", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");
    const sidebar = document.querySelector(".sidebar") as HTMLElement;

    drag(0, -500);
    expect(parseInt(sidebar.style.width, 10)).toBe(180);
  });

  it("clamps the sidebar at 40% of a measurable layout width on a large rightward drag", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");
    const layout = document.querySelector(".layout") as HTMLElement;
    const sidebar = document.querySelector(".sidebar") as HTMLElement;
    // jsdom reports 0 for clientWidth; make the layout measurable so the
    // min(480, 40% of layout) branch (rather than the 480 fallback) is exercised.
    Object.defineProperty(layout, "clientWidth", { configurable: true, value: 1000 });

    drag(0, 1000);
    // 40% of 1000 = 400, which is under the 480 ceiling, so the width clamps at 400.
    expect(parseInt(sidebar.style.width, 10)).toBe(400);
  });
});
