import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

describe("sidebar lists repositories as expandable rows", () => {
  it("shows one row per repository with a worktree count badge", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");

    const rows = [...document.querySelectorAll(".sb-repo")];
    expect(rows).toHaveLength(2);
    const wc = screen.getByText("wings-core").closest(".sb-repo") as HTMLElement;
    const lonely = screen.getByText("lonely").closest(".sb-repo") as HTMLElement;
    expect(within(wc).getByText("2", { selector: ".sb-count" })).toBeTruthy();
    expect(within(lonely).getByText("1", { selector: ".sb-count" })).toBeTruthy();
  });

  it("expands and collapses a repository row to reveal and hide its worktrees", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    const user = userEvent.setup();
    render(<App />);
    const wc = (await screen.findByText("wings-core")).closest(".sb-repo") as HTMLElement;

    // collapsed on cold start → no leaves
    expect(wc.querySelectorAll(".sb-leaf")).toHaveLength(0);

    await user.click(within(wc).getByRole("button", { name: /expand repository/i }));
    expect(wc.querySelectorAll(".sb-leaf")).toHaveLength(2);

    await user.click(within(wc).getByRole("button", { name: /collapse repository/i }));
    expect(wc.querySelectorAll(".sb-leaf")).toHaveLength(0);
  });
});

describe("layout: top bar stays, sidebar is chrome-free, nothing selected shows a prompt", () => {
  it("keeps the top-bar controls and gives the sidebar no chrome of its own", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");

    // top bar controls
    expect(screen.getByText("🗂️ OpenSpec Board")).toBeInTheDocument();
    expect(screen.getByTitle("Settings")).toBeInTheDocument();
    expect(screen.getByTitle("Toggle dark / light")).toBeInTheDocument();
    expect(screen.getByText(/change\(s\) ·/)).toBeInTheDocument();

    // sidebar carries no title / settings / status strip of its own
    const sidebar = document.querySelector(".sidebar") as HTMLElement;
    expect(sidebar.querySelector("h1")).toBeNull();
    expect(sidebar.querySelector(".settings-btn")).toBeNull();
    expect(sidebar.querySelector(".meta")).toBeNull();
  });

  it("does not stack all repositories and shows a neutral prompt on cold start", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    render(<App />);
    await screen.findByText("wings-core");

    // no change cards are rendered in the main panel until a selection is made
    expect(document.querySelectorAll(".change")).toHaveLength(0);
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
    expect(screen.getByText("wc-a", { selector: ".cname" })).toBeInTheDocument();
    expect(screen.getByText("wc-b", { selector: ".cname" })).toBeInTheDocument();
    expect(screen.queryByText("solo", { selector: ".cname" })).toBeNull();
  });

  it("clicking the repository body selects it and auto-expands it", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    const user = userEvent.setup();
    render(<App />);
    const wc = (await screen.findByText("wings-core")).closest(".sb-repo") as HTMLElement;

    expect(wc.querySelectorAll(".sb-leaf")).toHaveLength(0); // collapsed
    await user.click(screen.getByText("wings-core"));

    expect(wc.className).toContain("selected"); // selected
    expect(wc.querySelectorAll(".sb-leaf")).toHaveLength(2); // auto-expanded
    expect(screen.getByText("wc-a", { selector: ".cname" })).toBeInTheDocument(); // main scoped to it
  });

  it("the chevron toggles expansion only, leaving the selection unchanged", async () => {
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoRepos(), 2)) });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("wings-core");

    // select lonely first
    await user.click(screen.getByText("lonely"));
    expect(screen.getByText("solo")).toBeInTheDocument();

    // expand wings-core via its chevron — selection must stay on lonely
    const wc = screen.getByText("wings-core").closest(".sb-repo") as HTMLElement;
    await user.click(within(wc).getByRole("button", { name: /expand repository/i }));

    expect(wc.querySelectorAll(".sb-leaf")).toHaveLength(2); // expanded
    expect(wc.className).not.toContain("selected"); // not selected
    expect(screen.getByText("solo")).toBeInTheDocument(); // lonely still the selection
  });
});

describe("worktree leaf composition", () => {
  it("shows branch title, directory basename, and a primary pill only on the primary checkout", async () => {
    const primary = makeChange({ change: "p", repoPath: "/Code/acme", repositoryId: "/Code/acme/.git", repositoryName: "acme", branch: "main", isPrimary: true });
    const linked = makeChange({ change: "l", repoPath: "/Code/acme-feat-x", repositoryId: "/Code/acme/.git", repositoryName: "acme", branch: "feat/x", isPrimary: false });
    expand("/Code/acme/.git");
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([primary, linked], 1)) });
    render(<App />);
    await screen.findByText("acme", { selector: ".sb-repo-name" });

    const primaryLeaf = screen.getByText("main").closest(".sb-leaf") as HTMLElement;
    const linkedLeaf = screen.getByText("feat/x").closest(".sb-leaf") as HTMLElement;

    expect(within(primaryLeaf).getByText("acme", { selector: ".sb-leaf-sub" })).toBeTruthy();
    expect(within(linkedLeaf).getByText("acme-feat-x", { selector: ".sb-leaf-sub" })).toBeTruthy();
    expect(primaryLeaf.querySelector(".sb-pill")).not.toBeNull();
    expect(linkedLeaf.querySelector(".sb-pill")).toBeNull();
  });
});

describe("per-worktree status indicator (least-done-wins)", () => {
  function leafFor(changes: ReturnType<typeof makeChange>[]) {
    expand("/Code/repo-a/.git");
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(changes, 1)) });
  }

  it("renders a green done dot when all changes are complete", async () => {
    leafFor([makeChange({ change: "done1", repoPath: "/Code/repo-a", complete: true })]);
    render(<App />);
    const el = await waitForLeaf();
    expect(el.querySelector(".sb-dot.done")).not.toBeNull();
  });

  it("renders the in-progress spinner when a change is applying", async () => {
    leafFor([makeChange({ change: "app1", repoPath: "/Code/repo-a", applying: true, complete: false })]);
    render(<App />);
    const el = await waitForLeaf();
    expect(el.querySelector(".spinner")).not.toBeNull();
  });

  it("renders the grey idle dot when nothing is active or complete", async () => {
    leafFor([makeChange({ change: "idle1", repoPath: "/Code/repo-a", complete: false })]);
    render(<App />);
    const el = (await waitForLeaf());
    expect(el.querySelector(".sb-dot.idle")).not.toBeNull();
  });

  it("least-done-wins keeps a mixed worktree in progress, not done", async () => {
    leafFor([
      makeChange({ change: "c-done", repoPath: "/Code/repo-a", complete: true }),
      makeChange({ change: "c-applying", repoPath: "/Code/repo-a", complete: false, applying: true }),
    ]);
    render(<App />);
    const el = await waitForLeaf();
    expect(el.querySelector(".spinner")).not.toBeNull();
    expect(el.querySelector(".sb-dot.done")).toBeNull();
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

    const titles = [...document.querySelectorAll(".sb-leaf-title")].map((e) => e.textContent);
    expect(titles).toEqual(["wt-human", "wt-active", "wt-done", "wt-idle"]);
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
    expect(document.querySelector(".sb-leaf.selected")).not.toBeNull();
    expect(await screen.findByText(/Branch diff —/)).toBeInTheDocument();
  });

  it("falls back to the neutral state when the persisted selection no longer exists", async () => {
    const c = makeChange({ change: "here", repoPath: "/Code/repo-a", repositoryId: "/Code/repo-a/.git" });
    localStorage.setItem("osb-selection", JSON.stringify({ kind: "worktree", repoPath: "/Code/gone" }));
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c], 1)) });
    render(<App />);
    await screen.findByText(/Select a repository/i);

    expect(document.querySelector(".sb-leaf.selected")).toBeNull();
    expect(document.querySelector(".diff-panel")).toBeNull();
  });
});

async function waitForLeaf(): Promise<HTMLElement> {
  const { waitFor } = await import("@testing-library/react");
  return waitFor(() => {
    const el = document.querySelector(".sb-leaf");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}
