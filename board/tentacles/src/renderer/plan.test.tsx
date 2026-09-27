import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockApi, planTurnChannel, planStreamChannel, planBusyChannel, planSessionEndedChannel } from "./test-fixtures";

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

  it("picking a folder and sending the first idea starts the session with the idea only", async () => {
    const api = mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();

    await gotoPlan(user);
    await user.click(screen.getByRole("button", { name: /choose folder/i }));
    expect(await screen.findByText("/Code/my-proj")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/describe your idea/i), "add a dark mode toggle");
    await user.click(screen.getByRole("button", { name: /start refinement/i }));

    await waitFor(() => expect(api.startPlanSession).toHaveBeenCalledWith({ idea: "add a dark mode toggle" }));
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
  it("groups consecutive turns from the same amigo into one message, keeping a different speaker separate", async () => {
    const chan = planTurnChannel();
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    act(() => {
      chan.emit({ speaker: "BA", text: "First thought." });
      chan.emit({ speaker: "BA", text: "Second thought." });
      chan.emit({ speaker: "QA", text: "A different voice." });
    });

    const baGroups = (await screen.findAllByTestId("chat-turn")).filter((t) => t.getAttribute("data-speaker") === "BA");
    // Two consecutive BA turns collapse into one message with a single header,
    // both lines shown in arrival order (the message grew line by line).
    expect(baGroups).toHaveLength(1);
    expect(within(baGroups[0]).getAllByText("BA")).toHaveLength(1);
    expect(within(baGroups[0]).getAllByTestId("turn-line").map((l) => l.textContent)).toEqual([
      "First thought.",
      "Second thought.",
    ]);
    // The different speaker stays its own message.
    const qaGroups = screen.getAllByTestId("chat-turn").filter((t) => t.getAttribute("data-speaker") === "QA");
    expect(qaGroups).toHaveLength(1);
  });

  it("streams the partial line word by word, then shows the committed turn when it lands", async () => {
    const chan = planTurnChannel();
    const stream = planStreamChannel();
    mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      onPlanTurn: chan.onPlanTurn,
      onPlanStream: stream.onPlanStream,
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    // The partial grows word by word (no committed turn yet).
    act(() => stream.set({ speaker: "BA", text: "What" }));
    expect(await screen.findByText("What")).toBeInTheDocument();
    act(() => stream.set({ speaker: "BA", text: "What problem?" }));
    expect(await screen.findByText("What problem?")).toBeInTheDocument();

    // The line commits as a turn and the partial clears — no duplicate.
    act(() => {
      chan.emit({ speaker: "BA", text: "What problem?" });
      stream.set(null);
    });
    const baLines = within(
      (await screen.findAllByTestId("chat-turn")).find((t) => t.getAttribute("data-speaker") === "BA")!
    ).getAllByTestId("turn-line");
    expect(baLines.map((l) => l.textContent)).toEqual(["What problem?"]);
  });

  it("renders BA then QA turns as distinct named speakers in order", async () => {
    const chan = planTurnChannel();
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
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
    const busy = planBusyChannel();
    const api = mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanBusy: busy.onPlanBusy });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);
    act(() => busy.set(false));

    await user.type(screen.getByLabelText(/your reply/i), "here is my answer");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(api.sendPlanTurn).toHaveBeenCalledWith("here is my answer"));
    expect(await screen.findByText("here is my answer")).toBeInTheDocument();
  });

  it("submits the reply on Enter and on Ctrl+Enter, but Shift+Enter does not submit", async () => {
    const busy = planBusyChannel();
    const api = mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanBusy: busy.onPlanBusy });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);
    act(() => busy.set(false));

    const box = screen.getByLabelText(/your reply/i);
    await user.click(box);
    await user.type(box, "first answer{Enter}");
    await waitFor(() => expect(api.sendPlanTurn).toHaveBeenCalledWith("first answer"));
    act(() => busy.set(false));

    // Shift+Enter must NOT submit (it inserts a newline).
    await user.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(api.sendPlanTurn).toHaveBeenCalledTimes(1);

    // Ctrl+Enter submits.
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.sendPlanTurn).toHaveBeenCalledTimes(2));
  });

  it("shows a thinking indicator and locks the reply box while an amigo is generating, then unlocks", async () => {
    const busy = planBusyChannel();
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanBusy: busy.onPlanBusy });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    // The first idea optimistically enters the thinking state and locks the box.
    expect(await screen.findByTestId("thinking")).toBeInTheDocument();
    expect(screen.getByLabelText(/your reply/i)).toBeDisabled();

    act(() => busy.set(false));

    expect(screen.queryByTestId("thinking")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/your reply/i)).not.toBeDisabled();
  });

  it("keeps the thinking indicator visible while the agent works even when a partial is streaming", async () => {
    const busy = planBusyChannel();
    const stream = planStreamChannel();
    mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      onPlanBusy: busy.onPlanBusy,
      onPlanStream: stream.onPlanStream,
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    // A partial line is on screen mid-generation — the dots must still show so the
    // user has evidence the agent is working, not frozen.
    act(() => stream.set({ speaker: "BA", text: "What" }));
    expect(await screen.findByText("What")).toBeInTheDocument();
    expect(screen.getByTestId("thinking")).toBeInTheDocument();

    act(() => busy.set(false));
    expect(screen.queryByTestId("thinking")).not.toBeInTheDocument();
  });
});

describe("PLAN — the docs step is relayed by the agent, not refereed by the app", () => {
  it("renders docs offer/written/revised turns in order like any turn and relays the user's agreement", async () => {
    const chan = planTurnChannel();
    const busy = planBusyChannel();
    const api = mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn, onPlanBusy: busy.onPlanBusy });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user, "add a feature");
    act(() => busy.set(false));

    act(() => chan.emit({ speaker: "system", text: "No tentacles docs found. Create them?" }));
    expect(await screen.findByText(/no tentacles docs found/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/your reply/i), "yes please");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(api.sendPlanTurn).toHaveBeenCalledWith("yes please"));

    act(() => {
      chan.emit({ speaker: "system", text: "Docs written." });
      chan.emit({ speaker: "system", text: "Docs revised." });
    });

    const texts = (await screen.findAllByTestId("turn-line")).map((t) => t.textContent ?? "");
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
    expect((api as unknown as Record<string, unknown>).checkTentaclesDocs).toBeUndefined();
    expect((api as unknown as Record<string, unknown>).tentaclesPresence).toBeUndefined();
    expect(screen.getByRole("button", { name: /choose folder/i })).toBeInTheDocument();
  });

  it("labels non-persona (system) turns as Tentacles, not System", async () => {
    const chan = planTurnChannel();
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    act(() => chan.emit({ speaker: "system", text: "Loading the refinement procedure." }));

    const sys = (await screen.findAllByTestId("chat-turn")).find((t) => t.getAttribute("data-speaker") === "system")!;
    expect(sys).toBeTruthy();
    expect(within(sys).getByText("Tentacles")).toBeInTheDocument();
    expect(within(sys).queryByText("System")).not.toBeInTheDocument();
  });
});

describe("PLAN — the ticket can be opened", () => {
  it("asks main to open the ticket without supplying a path", async () => {
    const api = mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: /open externally/i }));

    expect(api.openTicket).toHaveBeenCalledWith();
  });

  it("surfaces an open-ticket failure as an error turn", async () => {
    const api = mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      openTicket: vi.fn().mockResolvedValue({ ok: false, error: "no ticket yet" }),
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: /open externally/i }));

    const err = (await screen.findAllByTestId("chat-turn")).find((t) => t.getAttribute("data-speaker") === "error")!;
    expect(err).toBeTruthy();
    expect(within(err).getByText(/no ticket yet/i)).toBeInTheDocument();
    expect(api.openTicket).toHaveBeenCalled();
  });
});

describe("PLAN — new refinement warns then resets", () => {
  it("cancelling the warning keeps the chat and wipes nothing", async () => {
    const api = mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: "New refinement" }));
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(api.newRefinement).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/your reply/i)).toBeInTheDocument();
  });

  it("confirming wipes the ticket (no path arg) and returns to the folder picker", async () => {
    const api = mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: "New refinement" }));
    await user.click(await screen.findByRole("button", { name: /discard ticket and start over/i }));

    await waitFor(() => expect(api.newRefinement).toHaveBeenCalledWith());
    expect(await screen.findByRole("button", { name: /choose folder/i })).toBeInTheDocument();
  });
});

describe("PLAN — the session is ephemeral but survives phase switches", () => {
  it("keeps the chat when leaving PLAN and returning", async () => {
    const chan = planTurnChannel();
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
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
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: "BUILD" }));
    act(() => chan.emit({ speaker: "QA", text: "late question" }));
    await user.click(screen.getByRole("button", { name: "PLAN" }));

    expect(await screen.findByText("late question")).toBeInTheDocument();
  });
});

describe("PLAN — failures surface in the chat and the session becomes terminal", () => {
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
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }), onPlanTurn: chan.onPlanTurn });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    act(() => chan.emit({ speaker: "error", text: "the agent crashed" }));

    const errorTurn = (await screen.findAllByTestId("chat-turn")).find((t) => t.getAttribute("data-speaker") === "error")!;
    expect(errorTurn).toBeTruthy();
    expect(within(errorTurn).getByText("the agent crashed")).toBeInTheDocument();
  });

  it("disables the reply control once the session has ended", async () => {
    const ended = planSessionEndedChannel();
    const busy = planBusyChannel();
    mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      onPlanBusy: busy.onPlanBusy,
      onPlanSessionEnded: ended.onPlanSessionEnded,
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);
    act(() => busy.set(false));

    expect(screen.getByLabelText(/your reply/i)).not.toBeDisabled();

    act(() => ended.end());

    expect(await screen.findByTestId("session-ended")).toBeInTheDocument();
    expect(screen.getByLabelText(/your reply/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("surfaces a start-session failure as an error turn and disables the reply", async () => {
    mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      startPlanSession: vi.fn().mockResolvedValue({ ok: false, error: "start boom" }),
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    const err = (await screen.findAllByTestId("chat-turn")).find((t) => t.getAttribute("data-speaker") === "error")!;
    expect(err).toBeTruthy();
    expect(within(err).getByText(/start boom/i)).toBeInTheDocument();
    expect(await screen.findByTestId("session-ended")).toBeInTheDocument();
    expect(screen.getByLabelText(/your reply/i)).toBeDisabled();
  });

  it("surfaces a send failure as an error turn and disables the reply", async () => {
    const busy = planBusyChannel();
    mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      onPlanBusy: busy.onPlanBusy,
      sendPlanTurn: vi.fn().mockResolvedValue({ ok: false, error: "send boom" }),
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);
    act(() => busy.set(false));

    await user.type(screen.getByLabelText(/your reply/i), "an answer");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    const err = (await screen.findAllByTestId("chat-turn")).find(
      (t) => t.getAttribute("data-speaker") === "error" && /send boom/i.test(t.textContent ?? "")
    )!;
    expect(err).toBeTruthy();
    expect(await screen.findByTestId("session-ended")).toBeInTheDocument();
    expect(screen.getByLabelText(/your reply/i)).toBeDisabled();
  });

  it("surfaces a new-refinement failure as an error turn, keeps the chat, and disables the reply", async () => {
    mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      newRefinement: vi.fn().mockResolvedValue({ ok: false, error: "wipe boom" }),
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: "New refinement" }));
    await user.click(await screen.findByRole("button", { name: /discard ticket and start over/i }));

    const err = (await screen.findAllByTestId("chat-turn")).find(
      (t) => t.getAttribute("data-speaker") === "error" && /wipe boom/i.test(t.textContent ?? "")
    )!;
    expect(err).toBeTruthy();
    // The wipe failed, so the chat is kept — but terminal (main stopped the session).
    expect(await screen.findByTestId("session-ended")).toBeInTheDocument();
    expect(screen.getByLabelText(/your reply/i)).toBeDisabled();
  });
});

describe("PLAN — header, folder context and in-app ticket viewing", () => {
  it("titles the panel Three Amigos and credits Kiro", async () => {
    mockApi();
    render(<App />);
    const user = userEvent.setup();
    await gotoPlan(user);

    expect(screen.getByText("Three Amigos")).toBeInTheDocument();
    expect(screen.getByText(/powered by kiro/i)).toBeInTheDocument();
  });

  it("keeps the chosen folder visible after the chat begins", async () => {
    mockApi({ planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }) });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    expect(screen.getByTestId("plan-folder").textContent).toContain("/Code/my-proj");
  });

  it("views the ticket inside the app, rendering its HTML", async () => {
    const api = mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      readTicket: vi.fn().mockResolvedValue({ ok: true, html: "<h1>My Ticket</h1>" }),
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: /view ticket/i }));

    expect(api.readTicket).toHaveBeenCalledWith();
    const frame = await screen.findByTestId("ticket-frame");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>My Ticket</h1>");
  });

  it("surfaces a view-ticket failure as an error turn", async () => {
    const api = mockApi({
      planChooseFolder: vi.fn().mockResolvedValue({ path: "/Code/my-proj" }),
      readTicket: vi.fn().mockResolvedValue({ ok: false, error: "no ticket yet" }),
    });
    render(<App />);
    const user = userEvent.setup();
    await startSession(user);

    await user.click(screen.getByRole("button", { name: /view ticket/i }));

    const err = (await screen.findAllByTestId("chat-turn")).find((t) => t.getAttribute("data-speaker") === "error")!;
    expect(err).toBeTruthy();
    expect(within(err).getByText(/no ticket yet/i)).toBeInTheDocument();
    expect(api.readTicket).toHaveBeenCalled();
  });
});
