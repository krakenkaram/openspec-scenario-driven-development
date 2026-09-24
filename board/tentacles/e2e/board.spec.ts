import { test, expect } from "./helpers/launch";

// Group 4 — electron-app-smoke-coverage: "The board renders seeded change data".
test.describe("board renders seeded data", () => {
  test("phase chain and type/status badges render for a mid-flight change", async ({ app }) => {
    const card = app.page.locator("[data-change-card]", {
      has: app.page.getByRole("heading", { name: "add-search" }),
    });
    await expect(card).toBeVisible();

    // All five phases in their seeded states: grill + proposal done, specs in
    // progress, design + tasks pending.
    await expect(card.locator('[data-phase="grill"]')).toContainText("done");
    await expect(card.locator('[data-phase="proposal"]')).toContainText("done");
    await expect(card.locator('[data-phase="specs"][data-tone="progress"]')).toBeVisible();
    await expect(card.locator('[data-phase="design"][data-tone="pending"]')).toContainText("pending");
    await expect(card.locator('[data-phase="tasks"][data-tone="pending"]')).toContainText("pending");

    // A mid-flight, planning-incomplete feature carries FEATURE + PLANNING.
    await expect(card.getByText("FEATURE")).toBeVisible();
    await expect(card.getByText("PLANNING")).toHaveText("PLANNING");
  });

  test("a behaviour-preserving change carries the REFACTOR badge", async ({ app }) => {
    const card = app.page.locator("[data-change-card]", {
      has: app.page.getByRole("heading", { name: "refactor-cleanup" }),
    });
    await expect(card.getByText("REFACTOR")).toBeVisible();
  });
});
