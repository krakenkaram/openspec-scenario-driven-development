import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockApi } from "./test-fixtures";

async function gotoPlan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "PLAN" }));
}

describe("PLAN — folder picker and first idea", () => {
  it("opens on the folder picker with no chat and shows the kiro engine marker", async () => {
    mockApi();
    render(<App />);
    const user = userEvent.setup();

    await gotoPlan(user);

    expect(screen.getByTestId("plan-phase")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose folder/i })).toBeInTheDocument();
    expect(screen.getByTestId("kiro-engine")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-turn")).not.toBeInTheDocument();
  });

  it("picking a folder and sending the first idea starts the session and shows the user's turn", async () => {
    const api = mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();

    await gotoPlan(user);
    await user.click(screen.getByRole("button", { name: /choose folder/i }));
    expect(await screen.findByText("/Code/my-proj")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/describe your idea/i), "add a dark mode toggle");
    await user.click(screen.getByRole("button", { name: /start refinement/i }));

    await waitFor(() =>
      expect(api.startPlanSession).toHaveBeenCalledWith({ folderPath: "/Code/my-proj", idea: "add a dark mode toggle" })
    );
    expect(await screen.findByText("add a dark mode toggle")).toBeInTheDocument();
  });
});
