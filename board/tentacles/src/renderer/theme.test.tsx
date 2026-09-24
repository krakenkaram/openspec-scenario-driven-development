import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { theme } from "./theme";
import { mockApi } from "./test-fixtures";

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

describe("colour scheme follows the OS by default", () => {
  beforeEach(() => localStorage.clear());

  it("opens dark when the OS reports dark", async () => {
    stubColorScheme(true);
    mockApi();
    render(<App />);
    await waitFor(() => expect(schemeAttr()).toBe("dark"));
  });

  it("opens light when the OS reports light", async () => {
    stubColorScheme(false);
    mockApi();
    render(<App />);
    await waitFor(() => expect(schemeAttr()).toBe("light"));
  });
});

describe("the user can toggle the colour scheme and it persists", () => {
  beforeEach(() => localStorage.clear());

  it("toggling flips the colour scheme and stores the choice", async () => {
    stubColorScheme(true); // OS dark
    mockApi();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(schemeAttr()).toBe("dark"));

    await user.click(screen.getByRole("button", { name: /toggle .*light|colou?r scheme/i }));
    await waitFor(() => expect(schemeAttr()).toBe("light"));
    expect(localStorage.getItem("mantine-color-scheme-value")).toBe("light");
  });

  it("honours a previously stored explicit choice on load", async () => {
    stubColorScheme(true); // OS dark, but stored choice wins
    localStorage.setItem("mantine-color-scheme-value", "light");
    mockApi();
    render(<App />);
    await waitFor(() => expect(schemeAttr()).toBe("light"));
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
  it("respects the OS reduced-motion preference", () => {
    expect(theme.respectReducedMotion).toBe(true);
  });
});
