import { test, expect, selectRepo } from "./helpers/launch";

// phase-progress: a phase is complete only when the NEXT artifact exists. A change
// whose grill.md exists but whose proposal.md does not must render grill as
// in-progress — grill.md alone no longer marks grilling done.
test.describe("phase progress", () => {
  test("a change mid-grill shows the grill node in-progress, not done", async ({ app }) => {
    await selectRepo(app, "repo-beta");

    const card = app.page.locator("[data-change-card]", {
      has: app.page.getByRole("heading", { name: "draft-idea" }),
    });
    await expect(card).toBeVisible();

    await expect(card.locator('[data-phase="grill"][data-tone="progress"]')).toContainText("in progress");
    await expect(card.locator('[data-phase="grill"]')).not.toContainText("done");
    await expect(card.locator('[data-phase="proposal"][data-tone="pending"]')).toContainText("pending");
  });
});
