import { test, expect } from "./helpers/launch";

// Group 8 — electron-app-smoke-coverage: "The theme can be toggled".
// Mantine owns the colour scheme and sets data-mantine-color-scheme on the root;
// the legacy data-theme attribute was removed.
test.describe("theme toggle", () => {
  test("toggling flips the Mantine colour scheme between dark and light", async ({ app }) => {
    const scheme = () =>
      app.page.evaluate(() => document.documentElement.getAttribute("data-mantine-color-scheme"));

    const toggle = app.page.getByRole("button", { name: /toggle colou?r scheme/i });

    await toggle.click();
    const first = await scheme();
    expect(first === "light" || first === "dark").toBe(true);

    await toggle.click();
    const second = await scheme();
    expect(second === "light" || second === "dark").toBe(true);
    expect(second).not.toBe(first);
  });
});
