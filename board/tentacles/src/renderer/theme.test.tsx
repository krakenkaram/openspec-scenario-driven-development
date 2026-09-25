import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { theme } from "./theme";
import { ChangeCard } from "./board";
import { renderWithMantine } from "./test-utils";
import { makeChange, mockApi } from "./test-fixtures";

// Drive prefers-color-scheme: dark true/false; other queries (reduced motion) stay
// unmatched. Mantine's "auto" scheme reads (prefers-color-scheme: dark).
function stubColorScheme(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: /prefers-color-scheme: dark/.test(query) ? dark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const schemeAttr = () => document.documentElement.getAttribute("data-mantine-color-scheme");

describe("dark mode is forced (light mode disabled)", () => {
  beforeEach(() => localStorage.clear());

  it("opens dark even when the OS reports light", async () => {
    stubColorScheme(false);
    mockApi();
    render(<App />);
    await waitFor(() => expect(schemeAttr()).toBe("dark"));
  });

  it("ignores a stored light choice and stays dark", async () => {
    stubColorScheme(false);
    localStorage.setItem("mantine-color-scheme-value", "light");
    mockApi();
    render(<App />);
    await waitFor(() => expect(schemeAttr()).toBe("dark"));
  });

  it("shows no colour-scheme toggle in the top bar", async () => {
    stubColorScheme(true);
    mockApi();
    render(<App />);
    await screen.findByText("Tentacles");
    expect(screen.queryByTitle("Toggle dark / light")).toBeNull();
  });
});

describe("brand palette", () => {
  it("uses the magenta brand as the primary colour, not the old blue", () => {
    expect(theme.primaryColor).toBe("magenta");
    expect(theme.colors?.magenta?.[6]).toBe("#d6197d");
    // the deep purple support colour is registered
    expect(theme.colors?.purple?.[7]).toBe("#4a2c6f");
  });
});

describe("reduced motion", () => {
  function stubReducedMotion(reduce: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion: reduce/.test(query) ? reduce : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  const renderCard = () =>
    renderWithMantine(
      <ChangeCard
        c={makeChange({ change: "motion-demo" })}
        showBranch={false}
        openArtifacts={() => {}}
        onArchive={() => {}}
        busy={false}
        removing={false}
      />
    );

  it("does not animate the change card when the OS requests reduced motion", async () => {
    stubReducedMotion(true);
    renderCard();
    const cardEl = (await screen.findByText("motion-demo")).closest("[data-change-card]") as HTMLElement;
    await waitFor(() => expect(cardEl.style.transition).toBe(""));
  });

  it("animates the change card when motion is allowed", async () => {
    stubReducedMotion(false);
    renderCard();
    const cardEl = (await screen.findByText("motion-demo")).closest("[data-change-card]") as HTMLElement;
    await waitFor(() => expect(cardEl.style.transition).toContain("opacity"));
  });
});
