import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockApi, makeStatus, makeChange, selectRepo } from "./test-fixtures";

describe("phase rail — PLAN / BUILD / RELEASE", () => {
  it("shows the three phase squares", async () => {
    mockApi();
    render(<App />);
    expect(await screen.findByRole("button", { name: "PLAN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BUILD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RELEASE" })).toBeInTheDocument();
  });

  it("opens on BUILD by default", async () => {
    mockApi();
    render(<App />);
    const build = await screen.findByRole("button", { name: "BUILD" });
    expect(build).toHaveAttribute("aria-current", "true");
    // BUILD shows the board (its empty-state copy with a mocked empty status).
    expect(await screen.findByText(/no active openspec changes/i)).toBeInTheDocument();
  });

  it("switches the main view when a phase square is clicked", async () => {
    mockApi();
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "PLAN" }));
    expect(screen.getByRole("button", { name: "PLAN" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("plan-phase")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "RELEASE" }));
    expect(screen.getByRole("button", { name: "RELEASE" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("release-phase")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "BUILD" }));
    expect(screen.getByRole("button", { name: "BUILD" })).toHaveAttribute("aria-current", "true");
    expect(await screen.findByText(/no active openspec changes/i)).toBeInTheDocument();
  });

  it("preserves the BUILD selection when returning from PLAN", async () => {
    selectRepo("/Code/repo-a/.git");
    mockApi({
      getStatus: async () => makeStatus([makeChange({ repositoryId: "/Code/repo-a/.git", repositoryName: "repo-a" })]),
    } as never);
    render(<App />);
    const user = userEvent.setup();

    // On BUILD, the selected repo's name is shown in the main panel.
    expect(await screen.findAllByText("repo-a")).not.toHaveLength(0);

    await user.click(await screen.findByRole("button", { name: "PLAN" }));
    expect(screen.getByTestId("plan-phase")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "BUILD" }));
    // Same selection still drives the main panel.
    expect(await screen.findAllByText("repo-a")).not.toHaveLength(0);
  });

  it("preserves BUILD-local UI state (the sidebar search) across a phase round-trip", async () => {
    selectRepo("/Code/repo-a/.git");
    mockApi({
      getStatus: async () => makeStatus([makeChange({ repositoryId: "/Code/repo-a/.git", repositoryName: "repo-a" })]),
    } as never);
    render(<App />);
    const user = userEvent.setup();

    // Type into the sidebar's search box — state that lives inside the BUILD
    // subtree, so it is lost if BUILD unmounts on a phase switch.
    const search = await screen.findByPlaceholderText(/search repositories/i);
    await user.type(search, "repo-a");
    expect(search).toHaveValue("repo-a");

    await user.click(screen.getByRole("button", { name: "PLAN" }));
    expect(screen.getByTestId("plan-phase")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "BUILD" }));

    // The search text is still there — BUILD was hidden, not unmounted.
    expect(screen.getByPlaceholderText(/search repositories/i)).toHaveValue("repo-a");
  });
});
