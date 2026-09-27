import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { makeStatus, mockApi } from "./test-fixtures";
import type { SchemaInfo } from "../shared/ipc-contract";

const schema = (name: string): SchemaInfo => ({
  name,
  description: "",
  artifacts: [],
  scope: "global",
  action: "none",
});
const SCHEMAS = [schema("atdd-driven"), schema("refactor"), schema("spec-driven")];

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle("Settings"));
  await waitFor(() => expect(screen.getByLabelText("Scan root directory")).toBeInTheDocument());
}

describe("settings — schema assignment (work type → schema)", () => {
  it("loads the persisted assignment across the three fixed work types", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([])),
      getSettings: vi.fn().mockResolvedValue({
        root: "/Code",
        notifications: "enabled",
        targets: [],
        schemaAssignment: { feature: "atdd-driven", refactor: "refactor", testing: null },
      }),
      listSchemas: vi.fn().mockResolvedValue(SCHEMAS),
    });
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);

    expect(((await screen.findByLabelText("Feature schema")) as HTMLSelectElement).value).toBe("atdd-driven");
    expect((screen.getByLabelText("Refactor schema") as HTMLSelectElement).value).toBe("refactor");
    // Testing is None
    expect((screen.getByLabelText("Testing schema") as HTMLSelectElement).value).toBe("");
  });

  it("offers exactly the listSchemas pool plus None as the choices for a work type", async () => {
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([])),
      getSettings: vi.fn().mockResolvedValue({
        root: "/Code",
        notifications: "enabled",
        targets: [],
        schemaAssignment: { feature: "atdd-driven", refactor: "refactor", testing: null },
      }),
      listSchemas: vi.fn().mockResolvedValue(SCHEMAS),
    });
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);

    const select = await screen.findByLabelText("Feature schema");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["None", "atdd-driven", "refactor", "spec-driven"]);
  });

  it("sends the changed assignment through setSettings alongside the other settings", async () => {
    const setSettings = vi.fn().mockResolvedValue({
      ok: true,
      root: "/Code",
      notifications: "enabled",
      targets: [],
      schemaAssignment: { feature: "atdd-driven", refactor: "refactor", testing: "atdd-driven" },
    });
    mockApi({
      getStatus: vi.fn().mockResolvedValue(makeStatus([])),
      getSettings: vi.fn().mockResolvedValue({
        root: "/Code",
        notifications: "enabled",
        targets: [],
        schemaAssignment: { feature: "atdd-driven", refactor: "refactor", testing: null },
      }),
      listSchemas: vi.fn().mockResolvedValue(SCHEMAS),
      setSettings,
    });
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);

    await user.selectOptions(await screen.findByLabelText("Testing schema"), "atdd-driven");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(setSettings).toHaveBeenCalledWith({
      root: "/Code",
      notifications: "enabled",
      targets: [],
      schemaAssignment: { feature: "atdd-driven", refactor: "refactor", testing: "atdd-driven" },
    });
  });
});
