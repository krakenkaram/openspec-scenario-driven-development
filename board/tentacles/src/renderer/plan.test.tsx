import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockApi, planTurnChannel } from "./test-fixtures";

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

async function startSession(user: ReturnType<typeof userEvent.setup>, idea = "add a dark mode toggle") {
  await gotoPlan(user);
  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.type(screen.getByLabelText(/describe your idea/i), idea);
  await user.click(screen.getByRole("button", { name: /start refinement/i }));
}

describe("PLAN — amigos stream as named speakers and the user replies", () => {
  it("renders BA then QA turns as distinct named speakers in order", async () => {
    const chan = planTurnChannel();
    mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    act(() => {
      chan.emit({ speaker: "BA", text: "What problem does this solve?" });
      chan.emit({ speaker: "QA", text: "Any edge cases?" });
    });

    const turns = await screen.findAllByTestId("chat-turn");
    const ba = turns.find((t) => t.getAttribute("data-speaker") === "BA")!;
    const qa = turns.find((t) => t.getAttribute("data-speaker") === "QA")!;
    expect(ba).toBeTruthy();
    expect(qa).toBeTruthy();
    expect(within(ba).getByText("BA")).toBeInTheDocument();
    expect(within(ba).getByText("What problem does this solve?")).toBeInTheDocument();
    expect(within(qa).getByText("QA")).toBeInTheDocument();
    expect(ba.compareDocumentPosition(qa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("relays the user's mid-session reply and shows it as the user", async () => {
    const api = mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.type(screen.getByLabelText(/your reply/i), "here is my answer");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(api.sendPlanTurn).toHaveBeenCalledWith("here is my answer"));
    expect(await screen.findByText("here is my answer")).toBeInTheDocument();
  });
});

describe("PLAN — the docs step is relayed by the agent, not refereed by the app", () => {
  it("renders docs offer/written/revised turns in order like any turn and relays the user's agreement", async () => {
    const chan = planTurnChannel();
    const api = mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user, "add a feature");

    act(() => chan.emit({ speaker: "system", text: "No tentacles docs found. Create them?" }));
    expect(await screen.findByText(/no tentacles docs found/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/your reply/i), "yes please");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(api.sendPlanTurn).toHaveBeenCalledWith("yes please"));

    act(() => {
      chan.emit({ speaker: "system", text: "Docs written." });
      chan.emit({ speaker: "system", text: "Docs revised." });
    });

    const texts = (await screen.findAllByTestId("chat-turn")).map((t) => t.textContent ?? "");
    const iOffer = texts.findIndex((x) => x.includes("Create them"));
    const iWritten = texts.findIndex((x) => x.includes("Docs written"));
    const iRevised = texts.findIndex((x) => x.includes("Docs revised"));
    expect(iOffer).toBeGreaterThanOrEqual(0);
    expect(iOffer).toBeLessThan(iWritten);
    expect(iWritten).toBeLessThan(iRevised);
  });

  it("renders no docs-specific gate or affordance of its own", async () => {
    const api = mockApi();
    render(<App />);
    const user = userEvent.setup();
    await gotoPlan(user);
    // PLAN exposes no folder-probe / docs-check on its API surface.
    expect((api as unknown as Record<string, unknown>).checkTentaclesDocs).toBeUndefined();
    expect((api as unknown as Record<string, unknown>).tentaclesPresence).toBeUndefined();
    // The picker is reachable with no docs-approval gate blocking the phase.
    expect(screen.getByRole("button", { name: /choose folder/i })).toBeInTheDocument();
  });
});

describe("PLAN — the ticket can be opened", () => {
  it("offers to open the ticket at the conventional path in the picked folder", async () => {
    const api = mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: /open ticket/i }));

    expect(api.openPath).toHaveBeenCalledWith("/Code/my-proj/.tentacles/TICKET.html");
  });
});

describe("PLAN — new refinement warns then resets", () => {
  it("cancelling the warning keeps the chat and wipes nothing", async () => {
    const api = mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: "New refinement" }));
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(api.newRefinement).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/your reply/i)).toBeInTheDocument();
  });

  it("confirming wipes the ticket and returns to the folder picker", async () => {
    const api = mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: "New refinement" }));
    await user.click(await screen.findByRole("button", { name: /discard ticket and start over/i }));

    await waitFor(() => expect(api.newRefinement).toHaveBeenCalledWith("/Code/my-proj"));
    expect(await screen.findByRole("button", { name: /choose folder/i })).toBeInTheDocument();
  });
});

describe("PLAN — the session is ephemeral but survives phase switches", () => {
  it("keeps the chat when leaving PLAN and returning", async () => {
    const chan = planTurnChannel();
    mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    act(() => chan.emit({ speaker: "BA", text: "a question" }));
    expect(await screen.findByText("a question")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "BUILD" }));
    await user.click(screen.getByRole("button", { name: "PLAN" }));

    expect(screen.getByText("a question")).toBeInTheDocument();
  });

  it("shows a turn that arrived while the user was on another phase", async () => {
    const chan = planTurnChannel();
    mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: "BUILD" }));
    act(() => chan.emit({ speaker: "QA", text: "late question" }));
    await user.click(screen.getByRole("button", { name: "PLAN" }));

    expect(await screen.findByText("late question")).toBeInTheDocument();
  });
});

describe("PLAN — failures surface in the chat with no up-front gate", () => {
  it("keeps the folder picker reachable even before any session (no up-front gate)", async () => {
    mockApi();
    render(<App />);
    const user = userEvent.setup();
    await gotoPlan(user);
    expect(screen.getByRole("button", { name: /choose folder/i })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-turn")).not.toBeInTheDocument();
  });

  it("renders an agent error turn distinctly in the chat", async () => {
    const chan = planTurnChannel();
    mockApi({ chooseDirectory: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    act(() => chan.emit({ speaker: "error", text: "the agent crashed" }));

    const errorTurn = (await screen.findAllByTestId("chat-turn")).find((t) => t.getAttribute("data-speaker") === "error")!;
    expect(errorTurn).toBeTruthy();
    expect(within(errorTurn).getByText("the agent crashed")).toBeInTheDocument();
  });
});
