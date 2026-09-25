import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { ArchiveResult } from "../shared/ipc-contract";
import { makeChange, makeStatus, mockApi, selectRepo } from "./test-fixtures";

// The card's own "Archive" button opens a confirmation dialog; the dialog then
// carries its own confirm button. Scope confirm/cancel clicks to the dialog so
// they never collide with the card control.
const confirmArchive = async (user: ReturnType<typeof userEvent.setup>) => {
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^Archive/ }));
};

describe("archive", () => {
  beforeEach(() => {
    localStorage.clear();
    selectRepo();
  });
  afterEach(() => vi.restoreAllMocks());

  it("confirmed archive calls the bridge and removes the row", async () => {
    const c = makeChange({ change: "arch-me", repoPath: "/Code/repo-a" });
    const api = mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("arch-me");
    await user.click(screen.getByText("Archive"));
    await confirmArchive(user);

    expect(api.archive).toHaveBeenCalledWith({ repoPath: "/Code/repo-a", change: "arch-me" });
    await waitFor(() => expect(screen.queryByText("arch-me")).toBeNull());
  });

  it("cancelled confirmation performs no archive", async () => {
    const c = makeChange({ change: "keep-me" });
    const api = mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])) });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("keep-me");
    await user.click(screen.getByText("Archive"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(api.archive).not.toHaveBeenCalled();
    expect(screen.getByText("keep-me")).toBeInTheDocument();
  });

  it("a failed archive surfaces the error and keeps the row", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const c = makeChange({ change: "fail-me" });
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c])),
      archive: vi.fn().mockResolvedValue({ ok: false, error: "boom" }),
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("fail-me");
    await user.click(screen.getByText("Archive"));
    await confirmArchive(user);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(String(alertSpy.mock.calls[0]?.[0])).toContain("boom");
    expect(screen.getByText("fail-me")).toBeInTheDocument();
  });

  it("a rejected archive plan surfaces the error and keeps the row", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const c = makeChange({ change: "plan-fail" });
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([c])),
      archivePlan: vi.fn().mockRejectedValue(new Error("plan boom")),
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("plan-fail");
    await user.click(screen.getByText("Archive"));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(String(alertSpy.mock.calls[0]?.[0])).toContain("plan boom");
    expect(screen.getByText("plan-fail")).toBeInTheDocument();
  });

  it("disables the control in-flight, blocks a duplicate submission, and re-enables on failure", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    let resolveArchive!: (v: ArchiveResult) => void;
    const archive = vi.fn(() => new Promise<ArchiveResult>((r) => (resolveArchive = r)));
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([makeChange({ change: "busy-me" })])), archive });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("busy-me");
    await user.click(screen.getByText("Archive"));
    await confirmArchive(user);

    // in-flight: the card control is disabled and relabelled
    const btn = await screen.findByRole("button", { name: "Archiving…" });
    expect(btn).toBeDisabled();
    expect(archive).toHaveBeenCalledTimes(1);

    // a second click while in-flight cannot invoke the bridge again
    fireEvent.click(btn);
    expect(archive).toHaveBeenCalledTimes(1);

    // a failed request re-enables the exact control
    await act(async () => {
      resolveArchive({ ok: false, error: "boom" });
    });
    expect(await screen.findByRole("button", { name: "Archive" })).toBeEnabled();
    expect(alertSpy).toHaveBeenCalled();
  });
});
