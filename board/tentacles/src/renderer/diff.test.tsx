import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { makeChange, makeStatus, mockApi, selectRepo } from "./test-fixtures";

// The diff is viewed by selecting a worktree leaf in the sidebar. Seed the repo
// as selected + expanded so its single worktree leaf is on screen, then click it.
beforeEach(() => {
  localStorage.clear();
  selectRepo();
});

function worktreeChange() {
  return makeChange({
    change: "wt-demo",
    repoPath: "/Code/repo-a",
    applying: true,
    planningComplete: true,
    apply: { source: "commits", total: 3, done: null, commits: 2, file: null },
  });
}

const LEAF = "/Code/repo-a";

const diffModel = {
  ok: true as const,
  files: [
    {
      path: "file.txt",
      status: "modified" as const,
      hunks: [{ lines: [{ kind: "add" as const, text: "new" }] }],
    },
  ],
};

describe("selecting a worktree opens its live branch diff inline", () => {
  it("requests the branch diff for the worktree's repoPath and renders it inline, not in a modal", async () => {
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(diffModel),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    expect(api.getDiff).toHaveBeenCalledWith("/Code/repo-a");
    // rendered inline in the main panel, with no modal overlay
    await waitFor(() => expect(document.querySelector(".diff-panel")).not.toBeNull());
    expect(document.querySelector(".diff-overlay")).toBeNull();
    expect(await screen.findByText("new")).toBeTruthy();
  });
});

describe("the inline diff classifies additions green and removals red", () => {
  it("classifies added and removed lines and renders line text as text, not DOM", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue({
        ok: true,
        files: [
          {
            path: "file.txt",
            status: "modified",
            hunks: [
              {
                lines: [
                  { kind: "context", text: "unchanged" },
                  { kind: "del", text: "old line" },
                  { kind: "add", text: evil },
                ],
              },
            ],
          },
        ],
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    const add = await waitFor(() => {
      const el = document.querySelector(".diff-line.add");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(document.querySelector(".diff-line.del")).not.toBeNull();
    expect(document.querySelector(".diff-line.context")).not.toBeNull();

    // XSS guard: the malicious line is text, no <img> element is created.
    expect(add.textContent).toContain(evil);
    expect(document.querySelector(".diff-body img")).toBeNull();
  });
});

describe("the inline diff refreshes live every 3s while the worktree is selected", () => {
  afterEach(() => vi.useRealTimers());

  it("re-requests the diff every 3s while selected, and stops once deselected", async () => {
    vi.useFakeTimers();
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(diffModel),
    });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.click(screen.getByTitle(LEAF));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getDiff).toHaveBeenCalledTimes(1); // initial fetch on select

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.getDiff).toHaveBeenCalledTimes(2); // re-requested on the 3s tick

    // deselect by selecting the repository row again → the panel unmounts
    fireEvent.click(document.querySelector(".sb-repo-row") as HTMLElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.getDiff).toHaveBeenCalledTimes(2); // no further polls once deselected
  });
});

describe("the inline diff degrades gracefully", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a neutral placeholder for an empty branch and keeps polling", async () => {
    vi.useFakeTimers();
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, files: [] })
      .mockResolvedValue(diffModel);
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])), getDiff });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByTitle(LEAF));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // empty branch → placeholder
    expect(screen.getByText(/No changes on this branch/i)).toBeTruthy();

    // keeps polling: the next non-empty result replaces the placeholder
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("new")).toBeTruthy();
    expect(screen.queryByText(/No changes on this branch/i)).toBeNull();
  });

  it("keeps the last diff with a 'couldn't refresh' indicator when a poll fails", async () => {
    vi.useFakeTimers();
    const getDiff = vi.fn().mockResolvedValueOnce(diffModel).mockRejectedValueOnce(new Error("bridge down")).mockResolvedValue(diffModel);
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])), getDiff });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByTitle(LEAF));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("new")).toBeTruthy();

    // a failing refresh retains the last diff and surfaces the indicator
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("new")).toBeTruthy();
    expect(screen.getByText(/couldn't refresh/i)).toBeTruthy();

    // the next successful poll clears the indicator
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText(/couldn't refresh/i)).toBeNull();
  });

  it("shows a loading state on first load until the first diff resolves", async () => {
    let resolveDiff!: (v: typeof diffModel) => void;
    const getDiff = vi.fn(
      (): Promise<typeof diffModel> => new Promise((r) => (resolveDiff = r))
    );
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])), getDiff });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await act(async () => {
      resolveDiff(diffModel);
    });
    expect(await screen.findByText("new")).toBeTruthy();
  });
});

describe("the inline diff lists files in a tree and can expand a file", () => {
  const nested = {
    ok: true as const,
    files: [
      { path: "src/main/core.ts", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "A" }] }] },
      { path: "src/renderer/app.tsx", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "B" }] }] },
      { path: "docs/adr/0001-deep/thing.md", status: "added" as const, hunks: [{ lines: [{ kind: "add" as const, text: "C" }] }] },
      { path: "README.md", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "D" }] }] },
    ],
  };

  it("groups files under folder rows and switches the shown file on click", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(nested),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    const dirLabels = await waitFor(() => {
      const labels = [...document.querySelectorAll(".diff-tree-dir")].map((e) => e.textContent);
      expect(labels.length).toBeGreaterThan(0);
      return labels;
    });
    expect(dirLabels).toContain("src/");
    expect(dirLabels).toContain("main/");
    expect(dirLabels).toContain("docs/adr/0001-deep/");

    const leaf = await screen.findByRole("button", { name: /core\.ts/ });
    expect(leaf).toHaveAttribute("title", "src/main/core.ts");

    await user.click(screen.getByRole("button", { name: /app\.tsx/ }));
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.queryByText("A")).toBeNull();
  });

  it("fetches and shows the whole file on expand and returns to the compact hunks on collapse", async () => {
    const compact = {
      ok: true as const,
      files: [
        {
          path: "big.txt",
          status: "modified" as const,
          hunks: [{ lines: [{ kind: "context" as const, text: "ctx-near" }, { kind: "add" as const, text: "changed" }] }],
        },
      ],
    };
    const full = {
      ok: true as const,
      files: [
        {
          path: "big.txt",
          status: "modified" as const,
          hunks: [
            {
              lines: [
                { kind: "context" as const, text: "ctx-far" },
                { kind: "context" as const, text: "ctx-near" },
                { kind: "add" as const, text: "changed" },
              ],
            },
          ],
        },
      ],
    };
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(compact),
      getFileDiff: vi.fn().mockResolvedValue(full),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    expect(await screen.findByText("changed")).toBeTruthy();
    expect(screen.queryByText("ctx-far")).toBeNull();

    await user.click(screen.getByRole("button", { name: /expand full file/i }));
    expect(api.getFileDiff).toHaveBeenCalledWith("/Code/repo-a", "big.txt");
    expect(await screen.findByText("ctx-far")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("ctx-far")).toBeNull();
    expect(screen.getByText("changed")).toBeTruthy();
  });
});

describe("the inline diff syntax-highlights code by language", () => {
  it("tokenises a known language into highlight.js spans", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue({
        ok: true,
        files: [
          {
            path: "src/core.ts",
            status: "modified" as const,
            hunks: [{ lines: [{ kind: "add" as const, text: "const answer = 42;" }] }],
          },
        ],
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    const keyword = await waitFor(() => {
      const el = document.querySelector(".diff-body .hljs-keyword");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(keyword.textContent).toBe("const");
    expect(document.querySelector(".diff-line.add")?.textContent).toContain("const answer = 42;");
  });

  it("renders an unknown extension as plain text without highlight spans", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue({
        ok: true,
        files: [
          {
            path: "notes.txt",
            status: "modified" as const,
            hunks: [{ lines: [{ kind: "context" as const, text: "const answer = 42;" }] }],
          },
        ],
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    await screen.findByText("const answer = 42;");
    expect(document.querySelector(".diff-body .hljs-keyword")).toBeNull();
  });
});
