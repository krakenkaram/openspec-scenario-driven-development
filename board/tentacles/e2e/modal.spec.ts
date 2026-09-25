import { test, expect, selectRepo } from "./helpers/launch";

// Group 7 — electron-app-smoke-coverage: "Artifact files open in a modal via a real read".
test.describe("file modal", () => {
  test("opening an artifact shows its real file contents", async ({ app }) => {
    await selectRepo(app, "repo-alpha");

    const card = app.page.locator("[data-change-card]", {
      has: app.page.getByRole("heading", { name: "add-search" }),
    });
    // The proposal phase is done → its node is clickable and opens the file.
    await card.locator('[data-phase="proposal"]').click();

    const modal = app.page.locator("[role='dialog']");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".markdown-body")).toContainText(
      "Full-text search across all discovered changes"
    );
  });
});
