import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockApi } from "./test-fixtures";
import type { SchemaInfo } from "../shared/ipc-contract";

const SCHEMAS: SchemaInfo[] = [
  { name: "atdd-driven", description: "ATDD-driven schema.", artifacts: ["grill", "proposal", "specs", "design", "tasks"] },
  { name: "spec-driven", description: "Default OpenSpec workflow.", artifacts: ["proposal", "specs", "design", "tasks"] },
];

async function openSchemasTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle("Settings"));
  await waitFor(() => expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument());
  await user.click(screen.getByRole("tab", { name: "Schemas" }));
}

describe("settings — Schemas tab: read-only available-schema reference", () => {
  it("lists each available schema with its name, description, and ordered steps", async () => {
    mockApi({ listSchemas: vi.fn().mockResolvedValue(SCHEMAS) });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);

    expect(await screen.findByText("atdd-driven")).toBeInTheDocument();
    expect(screen.getByText("ATDD-driven schema.")).toBeInTheDocument();
    expect(screen.getByText("spec-driven")).toBeInTheDocument();
    expect(screen.getByText("Default OpenSpec workflow.")).toBeInTheDocument();

    // Ordered steps rendered for each schema (arrow-joined).
    expect(screen.getByText("grill → proposal → specs → design → tasks")).toBeInTheDocument();
    expect(screen.getByText("proposal → specs → design → tasks")).toBeInTheDocument();
  });

  it("presents no control to edit, select, or create a schema", async () => {
    mockApi({ listSchemas: vi.fn().mockResolvedValue(SCHEMAS) });
    const user = userEvent.setup();
    render(<App />);
    await openSchemasTab(user);
    await screen.findByText("atdd-driven");

    expect(screen.queryByRole("button", { name: /create|new schema|add schema|edit/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
