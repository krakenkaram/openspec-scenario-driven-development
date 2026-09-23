import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockApi } from "./test-fixtures";
import type { SchemaInfo } from "../shared/ipc-contract";

const LOCAL_ATDD: SchemaInfo = {
  name: "atdd-driven",
  description: "ATDD-driven schema.",
  artifacts: ["grill", "proposal", "specs", "design", "tasks"],
  scope: "local",
  action: "install",
  path: "/repo/openspec/schemas/atdd-driven",
};
const GLOBAL_SPEC: SchemaInfo = {
  name: "spec-driven",
  description: "Default OpenSpec workflow.",
  artifacts: ["proposal", "specs", "design", "tasks"],
  scope: "global",
  action: "none",
  path: "/pkg/schemas/spec-driven",
};
const INSTALLED_ATDD: SchemaInfo = {
  ...LOCAL_ATDD,
  scope: "global",
  action: "uninstall",
  path: "/home/u/.local/share/openspec/schemas/atdd-driven",
};

async function openSchemasTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle("Settings"));
  await waitFor(() => expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument());
  await user.click(screen.getByRole("tab", { name: "Schemas" }));
}

describe("settings — Schemas tab: scope pills and install/uninstall", () => {
  it("lists each schema with its name, description, ordered steps, and folder path", async () => {
    mockApi({ listSchemas: vi.fn().mockResolvedValue([LOCAL_ATDD, GLOBAL_SPEC]) });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);

    expect(await screen.findByText("atdd-driven")).toBeInTheDocument();
    expect(screen.getByText("ATDD-driven schema.")).toBeInTheDocument();
    expect(screen.getByText("grill → proposal → specs → design → tasks")).toBeInTheDocument();
    expect(screen.getByText("/repo/openspec/schemas/atdd-driven")).toBeInTheDocument();
    expect(screen.getByText("/pkg/schemas/spec-driven")).toBeInTheDocument();
  });

  it("shows a Local pill for an app schema and a Global pill for a CLI schema", async () => {
    mockApi({ listSchemas: vi.fn().mockResolvedValue([LOCAL_ATDD, GLOBAL_SPEC]) });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);
    await screen.findByText("atdd-driven");

    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("offers Install on a local schema and no install/uninstall control on a package schema", async () => {
    mockApi({ listSchemas: vi.fn().mockResolvedValue([LOCAL_ATDD, GLOBAL_SPEC]) });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);
    await screen.findByText("atdd-driven");

    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /uninstall/i })).toBeNull();
  });

  it("installs a local schema, then refreshes so the row flips to Global with Uninstall", async () => {
    const installSchema = vi.fn().mockResolvedValue({ ok: true });
    const listSchemas = vi
      .fn()
      .mockResolvedValueOnce([LOCAL_ATDD])
      .mockResolvedValue([INSTALLED_ATDD]);
    mockApi({ listSchemas, installSchema });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);

    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect(installSchema).toHaveBeenCalledWith("atdd-driven");
    expect(await screen.findByRole("button", { name: "Uninstall" })).toBeInTheDocument();
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("uninstalls an installed schema", async () => {
    const uninstallSchema = vi.fn().mockResolvedValue({ ok: true });
    const listSchemas = vi
      .fn()
      .mockResolvedValueOnce([INSTALLED_ATDD])
      .mockResolvedValue([LOCAL_ATDD]);
    mockApi({ listSchemas, uninstallSchema });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);

    await user.click(await screen.findByRole("button", { name: "Uninstall" }));
    expect(uninstallSchema).toHaveBeenCalledWith("atdd-driven");
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("surfaces an error when an install fails", async () => {
    const installSchema = vi.fn().mockResolvedValue({ ok: false, error: "permission denied" });
    mockApi({ listSchemas: vi.fn().mockResolvedValue([LOCAL_ATDD]), installSchema });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);

    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
  });

  it("presents no control to edit or create a schema", async () => {
    mockApi({ listSchemas: vi.fn().mockResolvedValue([LOCAL_ATDD, GLOBAL_SPEC]) });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);
    await screen.findByText("atdd-driven");

    expect(screen.queryByRole("button", { name: /create|new schema|add schema|edit/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
