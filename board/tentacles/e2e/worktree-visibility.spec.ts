import { test, expect } from "./helpers/launch";

// worktree-visibility: two worktrees of one repository (shared git common-dir,
// stubbed) group under a single Repository row in the sidebar, each leaf labelled
// with its own git branch.
test.describe("worktree visibility", () => {
  test("concurrent worktrees group under one Repository row, one leaf per branch", async ({ app }) => {
    const group = app.page.locator("[data-repo]", {
      has: app.page.locator("[data-repo-name]", { hasText: "wings-core" }),
    });
    await expect(group).toBeVisible();

    // Expand the repository row to reveal its worktree leaves.
    await group.locator("[data-repo-row]").click();

    // exactly the two worktrees, grouped under the one row
    await expect(group.locator("[data-worktree-leaf]")).toHaveCount(2);

    // each leaf carries its own branch
    await expect(group.locator('[data-branch="feat-a"]')).toBeVisible();
    await expect(group.locator('[data-branch="feat-b"]')).toBeVisible();
  });
});
