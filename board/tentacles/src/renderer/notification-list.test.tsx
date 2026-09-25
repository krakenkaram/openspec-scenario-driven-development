import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockApi } from "./test-fixtures";
import type { AppNotification } from "../shared/ipc-contract";

beforeEach(() => localStorage.clear());

// Capture the handler the app registers so a test can push notifications the way
// the main process would over the notification event channel.
function setup() {
  let handler: ((n: AppNotification) => void) | undefined;
  mockApi({
    onNotification: vi.fn((cb: (n: AppNotification) => void) => {
      handler = cb;
      return () => {};
    }),
  });
  return { fire: (n: AppNotification) => act(() => handler?.(n)) };
}

const openBell = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Notifications" }));

describe("in-app notification bell", () => {
  it("shows an empty state until a notification arrives, then lists it under the bell", async () => {
    const { fire } = setup();
    const user = userEvent.setup();
    render(<App />);

    await openBell(user);
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();

    fire({ title: "grill complete", body: "my-change · grill", at: 1000 });

    expect(await screen.findByText("grill complete")).toBeInTheDocument();
    expect(screen.getByText("my-change · grill")).toBeInTheDocument();
  });

  it("lists multiple notifications newest-first", async () => {
    const { fire } = setup();
    const user = userEvent.setup();
    render(<App />);

    fire({ title: "first done", body: "b1", at: 1000 });
    fire({ title: "second done", body: "b2", at: 2000 });

    await openBell(user);
    await screen.findByText("second done");

    const items = Array.from(document.querySelectorAll("[data-notification]"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("second done");
    expect(items[1]?.textContent).toContain("first done");
  });

  it("empties the list when Clear is pressed", async () => {
    const { fire } = setup();
    const user = userEvent.setup();
    render(<App />);

    fire({ title: "x done", body: "y", at: 1 });
    await openBell(user);
    expect(await screen.findByText("x done")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Clear" }));
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });

  it("shows no indicator dot with zero notifications, and one once a notification arrives", async () => {
    const { fire } = setup();
    render(<App />);

    expect(document.querySelector("[data-bell-dot]")).toBeNull();

    await fire({ title: "arrived", body: "b", at: 1 });
    expect(document.querySelector("[data-bell-dot]")).not.toBeNull();
  });
});
