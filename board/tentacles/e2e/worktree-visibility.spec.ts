import { test, expect } from "./helpers/launch";

// worktree-visibility: two worktrees of one repository (shared git common-dir,
// stubbed) must group under a single Repository row, each card labelled with its
// own git branch.
test.describe("worktree visibility", () => {
  test("concurrent worktrees group under one Repository row with per-branch cards", async ({ app }) => {
    const group = app.page.locator("[data-repo]", {
      has: app.page.locator("[data-repo-name]", { hasText: "wings-core" }),
    });
    await expect(group).toBeVisible();

    // exactly the two worktree cards, grouped under the one row
    await expect(group.locator("[data-change-card]")).toHaveCount(2);

    // each card carries its own branch chip
    await expect(group.getByText("feat-a")).toBeVisible();
    await expect(group.getByText("feat-b")).toBeVisible();
  });
});
