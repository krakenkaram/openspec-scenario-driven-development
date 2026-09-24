import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
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
    // rendered inline in the main panel, with no diff overlay open
    await waitFor(() => expect(document.querySelector(".diff-panel")).not.toBeNull());
    expect(document.querySelector("[data-diff-overlay]")).toBeNull();
    expect(await screen.findByText("new")).toBeTruthy();
  });
});

describe("the branch diff opens in an on-demand overlay", () => {
  it("opens the same diff in a dismissible overlay", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(diffModel),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));
    await screen.findByText("new"); // inline diff present
    expect(document.querySelector("[data-diff-overlay]")).toBeNull(); // overlay closed by default

    await user.click(screen.getByRole("button", { name: /open in overlay/i }));
    const overlay = await waitFor(() => {
      const el = document.querySelector("[data-diff-overlay]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // the overlay renders the same diff content
    expect(within(overlay).getByText("new")).toBeTruthy();

    // and it can be dismissed
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.querySelector("[data-diff-overlay]")).toBeNull());
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
    fireEvent.click(document.querySelector("[data-repo-row]") as HTMLElement);
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

  it("treats a resolved { ok:false } refresh as a failure and keeps the last diff", async () => {
    vi.useFakeTimers();
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce(diffModel)
      .mockResolvedValueOnce({ ok: false, error: "unknown repo" })
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
    expect(screen.getByText("new")).toBeTruthy();

    // a poll that RESOLVES { ok:false } (not a rejection) must retain the last diff
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("new")).toBeTruthy();
    expect(screen.queryByText(/Could not load diff/i)).toBeNull();
    expect(screen.getByText(/couldn't refresh/i)).toBeTruthy();

    // the next successful poll clears the indicator
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText(/couldn't refresh/i)).toBeNull();
  });

  it("keeps a file expanded and refreshes its full contents across the 3s poll", async () => {
    vi.useFakeTimers();
    const compact = {
      ok: true as const,
      files: [{ path: "big.txt", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "changed-v1" }] }] }],
    };
    const fullV1 = {
      ok: true as const,
      files: [{ path: "big.txt", status: "modified" as const, hunks: [{ lines: [{ kind: "context" as const, text: "ctx-far" }, { kind: "add" as const, text: "changed-v1" }] }] }],
    };
    const fullV2 = {
      ok: true as const,
      files: [{ path: "big.txt", status: "modified" as const, hunks: [{ lines: [{ kind: "context" as const, text: "ctx-far" }, { kind: "add" as const, text: "changed-v2" }] }] }],
    };
    const getFileDiff = vi.fn().mockResolvedValueOnce(fullV1).mockResolvedValue(fullV2);
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      // fresh object per poll (as the real getDiff news-up each time), so the
      // panel re-renders and the expanded-file refresh effect runs.
      getDiff: vi.fn(() => Promise.resolve({ ok: true as const, files: compact.files.map((f) => ({ ...f })) })),
      getFileDiff,
    });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByTitle(LEAF));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // expand → full v1 shows
    fireEvent.click(screen.getByRole("button", { name: "Expand full file" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("ctx-far")).toBeTruthy();
    expect(screen.getByText("changed-v1")).toBeTruthy();

    // after the 3s poll: still expanded AND the full contents refreshed to v2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("ctx-far")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse" })).toBeTruthy();
    expect(screen.getByText("changed-v2")).toBeTruthy();
  });

  it("drops the expanded full file and falls back to the hunk view when a refresh returns empty/failed", async () => {
    vi.useFakeTimers();
    const compact = {
      ok: true as const,
      files: [{ path: "big.txt", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "hunk-line" }] }] }],
    };
    const full = {
      ok: true as const,
      files: [{ path: "big.txt", status: "modified" as const, hunks: [{ lines: [{ kind: "context" as const, text: "full-only-line" }, { kind: "add" as const, text: "hunk-line" }] }] }],
    };
    // first full fetch succeeds; the refresh after the poll fails (ok:false).
    const getFileDiff = vi.fn().mockResolvedValueOnce(full).mockResolvedValue({ ok: false as const, error: "gone" });
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn(() => Promise.resolve({ ok: true as const, files: compact.files.map((f) => ({ ...f })) })),
      getFileDiff,
    });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByTitle(LEAF));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // expand → full shows
    fireEvent.click(screen.getByRole("button", { name: "Expand full file" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("full-only-line")).toBeTruthy();

    // the 3s refresh returns a failed full-file result → the stale full file is
    // dropped and the compact hunk view is shown instead (never stale content).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText("full-only-line")).toBeNull();
    expect(screen.getByText("hunk-line")).toBeTruthy();
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

    const leaf = await screen.findByTitle("src/main/core.ts");
    expect(leaf).toHaveClass("diff-file-item");

    await user.click(screen.getByTitle("src/renderer/app.tsx"));
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

describe("clicking a diffed file name opens it in the OS-default app", () => {
  it("calls openFile with the repo path and the diff's relative file path", async () => {
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue({
        ok: true,
        files: [{ path: "src/x.ts", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "y" }] }] }],
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));
    await user.click(await screen.findByRole("button", { name: "src/x.ts" }));

    expect(api.openFile).toHaveBeenCalledWith("/Code/repo-a", "src/x.ts");
  });

  it("surfaces an error when the file cannot be opened", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const api = mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue({
        ok: true,
        files: [{ path: "src/x.ts", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "y" }] }] }],
      }),
      openFile: vi.fn().mockResolvedValue({ ok: false, error: "no application knows how to open" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));
    await user.click(await screen.findByRole("button", { name: "src/x.ts" }));

    expect(api.openFile).toHaveBeenCalledWith("/Code/repo-a", "src/x.ts");
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("no application knows how to open")));
    alertSpy.mockRestore();
  });
});

describe("the diff file-picker pane is drag-resizable", () => {
  it("widens on drag and clamps at the minimum on an over-drag left", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue({
        ok: true,
        files: [{ path: "a.txt", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text: "A" }] }] }],
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));

    const handle = await screen.findByRole("separator", { name: /resize file list/i });
    const pane = document.querySelector(".diff-sidebar") as HTMLElement;

    // drag right by 120px → wider
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 420 });
    fireEvent.mouseUp(document, { clientX: 420 });
    expect(parseInt(pane.style.width, 10)).toBeGreaterThan(240);

    // drag far left → clamps at the ~160px minimum, never collapses
    fireEvent.mouseDown(handle, { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document, { clientX: 0 });
    expect(parseInt(pane.style.width, 10)).toBe(160);
  });
});

describe("switching worktrees does not leak the previous worktree's diff", () => {
  function twoWorktrees() {
    const a = makeChange({ change: "a", repoPath: "/Code/wt-a", repositoryId: "/Code/multi/.git", repositoryName: "multi", branch: "wt-a-branch" });
    const b = makeChange({ change: "b", repoPath: "/Code/wt-b", repositoryId: "/Code/multi/.git", repositoryName: "multi", branch: "wt-b-branch", isPrimary: false });
    return [a, b];
  }
  const fileWith = (text: string) => ({
    ok: true as const,
    files: [{ path: "f.txt", status: "modified" as const, hunks: [{ lines: [{ kind: "add" as const, text }] }] }],
  });

  it("ignores a late response for worktree A after switching to B, rendering only B", async () => {
    localStorage.clear();
    localStorage.setItem("osb-expanded", JSON.stringify(["/Code/multi/.git"]));
    let resolveA!: (v: ReturnType<typeof fileWith>) => void;
    const getDiff = vi.fn((p: string) =>
      p === "/Code/wt-a"
        ? new Promise<ReturnType<typeof fileWith>>((r) => (resolveA = r))
        : Promise.resolve(fileWith("B-DATA"))
    );
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus(twoWorktrees(), 1)), getDiff });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle("/Code/wt-a")); // A panel mounts, diff pending
    await user.click(screen.getByTitle("/Code/wt-b")); // switch to B, which resolves
    expect(await screen.findByText("B-DATA")).toBeTruthy();

    // A's request now resolves late — it must not populate B's panel
    await act(async () => {
      resolveA(fileWith("A-DATA"));
    });
    expect(screen.getByText("B-DATA")).toBeTruthy();
    expect(screen.queryByText("A-DATA")).toBeNull();
  });
});

describe("the inline diff shows a two-column line-number gutter", () => {
  const numbered = {
    ok: true as const,
    files: [
      {
        path: "file.txt",
        status: "modified" as const,
        hunks: [
          {
            oldStart: 10,
            oldCount: 2,
            newStart: 10,
            newCount: 2,
            lines: [
              { kind: "context" as const, text: "ctx", oldNo: 10, newNo: 10 },
              { kind: "del" as const, text: "gone", oldNo: 11 },
              { kind: "add" as const, text: "added", newNo: 11 },
            ],
          },
        ],
      },
    ],
  };

  it("shows both numbers for context and only one side for add/del, blank on the absent side", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(numbered),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));
    await screen.findByText("ctx");

    const ctx = document.querySelector(".diff-line.context") as HTMLElement;
    expect(ctx.querySelector(".diff-gutter-old")?.textContent).toBe("10");
    expect(ctx.querySelector(".diff-gutter-new")?.textContent).toBe("10");

    const del = document.querySelector(".diff-line.del") as HTMLElement;
    expect(del.querySelector(".diff-gutter-old")?.textContent).toBe("11");
    expect(del.querySelector(".diff-gutter-new")?.textContent).toBe("");

    const add = document.querySelector(".diff-line.add") as HTMLElement;
    expect(add.querySelector(".diff-gutter-old")?.textContent).toBe("");
    expect(add.querySelector(".diff-gutter-new")?.textContent).toBe("11");
  });

  it("marks the gutter non-selectable so copying a diff line yields the code, not the numbers", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(numbered),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));
    await screen.findByText("ctx");

    const gutter = document.querySelector(".diff-gutter-old") as HTMLElement;
    expect(gutter).not.toBeNull();
    expect(gutter.style.userSelect).toBe("none");
  });
});

describe("the inline diff separates hunks with a header row", () => {
  const twoHunks = {
    ok: true as const,
    files: [
      {
        path: "file.txt",
        status: "modified" as const,
        hunks: [
          {
            oldStart: 1,
            oldCount: 2,
            newStart: 1,
            newCount: 2,
            lines: [
              { kind: "context" as const, text: "top", oldNo: 1, newNo: 1 },
              { kind: "add" as const, text: "first-change", newNo: 2 },
            ],
          },
          {
            oldStart: 50,
            oldCount: 2,
            newStart: 50,
            newCount: 2,
            lines: [
              { kind: "context" as const, text: "later", oldNo: 50, newNo: 50 },
              { kind: "add" as const, text: "second-change", newNo: 51 },
            ],
          },
        ],
      },
    ],
  };

  it("renders a hunk-header row showing the @@ range with blank gutter cells", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([worktreeChange()])),
      getDiff: vi.fn().mockResolvedValue(twoHunks),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByTitle(LEAF));
    await screen.findByText("second-change");

    const headers = [...document.querySelectorAll(".diff-hunk-header")];
    const ranges = headers.map((h) => h.textContent);
    expect(ranges.some((t) => t?.includes("@@ -50,2 +50,2 @@"))).toBe(true);

    // the header row's own gutter cells carry no number
    const secondHeader = headers.find((h) => h.textContent?.includes("@@ -50,2 +50,2 @@")) as HTMLElement;
    expect(secondHeader.querySelector(".diff-gutter-old")?.textContent).toBe("");
    expect(secondHeader.querySelector(".diff-gutter-new")?.textContent).toBe("");

    // the range sits in the code column: the row preserves the full
    // [old#][new#][sign][code] structure, so a blank sign cell precedes the text
    expect(secondHeader.querySelector(".diff-sign")?.textContent).toBe("");
    const order = [...secondHeader.children].map((c) => (c as HTMLElement).className);
    expect(order).toEqual([
      "diff-gutter diff-gutter-old",
      "diff-gutter diff-gutter-new",
      "diff-sign",
      "diff-text",
    ]);
  });
});
