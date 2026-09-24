import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import App from "./App";
import { makeChange, makeStatus, mockApi, selectRepo } from "./test-fixtures";

beforeEach(() => {
  localStorage.clear();
  selectRepo();
});

describe("board — schema chip reveals its schema.yaml in Finder", () => {
  it("reveals the change's schema.yaml when the schema name is clicked", async () => {
    const openSchemaFile = vi.fn().mockResolvedValue({ ok: true });
    const c = makeChange({ change: "schema-click", schema: "atdd-driven", repoPath: "/Code/wings-core-a" });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])), openSchemaFile });

    render(<App />);
    await screen.findByText("schema-click");

    const card = screen.getByText("schema-click").closest("[data-change-card]") as HTMLElement;
    within(card).getByRole("button", { name: "atdd-driven" }).click();

    expect(openSchemaFile).toHaveBeenCalledWith("atdd-driven", "/Code/wings-core-a");
  });

  it("surfaces the error when the schema.yaml cannot be revealed", async () => {
    const openSchemaFile = vi.fn().mockResolvedValue({ ok: false, error: "schema.yaml not found" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const c = makeChange({ change: "schema-fail", schema: "refactor", repoPath: "/Code/x" });
    mockApi({ getStatus: vi.fn().mockResolvedValue(makeStatus([c])), openSchemaFile });

    render(<App />);
    await screen.findByText("schema-fail");
    const card = screen.getByText("schema-fail").closest("[data-change-card]") as HTMLElement;
    within(card).getByRole("button", { name: "refactor" }).click();

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("schema.yaml not found")));
    alertSpy.mockRestore();
  });
});
