import { test, expect, selectRepo } from "./helpers/launch";

// item 6: artifacts render as formatted markdown (React elements), not raw source.
test.describe("markdown rendering", () => {
  test("the artifact modal renders headings and lists as elements, not raw markdown", async ({ app }) => {
    await selectRepo(app, "repo-alpha");

    const card = app.page.locator("[data-change-card]", {
      has: app.page.getByRole("heading", { name: "ship-export" }),
    });
    await card.locator('[data-phase="specs"]').click();

    const body = app.page.locator("[role='dialog'] .markdown-body");
    await expect(body).toBeVisible();

    await expect(body.locator("h1").first()).toBeVisible();
    await expect(body.locator("ul li").first()).toBeVisible();
    await expect(body).not.toContainText("## csv-export");
    await expect(body).not.toContainText("# CSV export capability");
  });
});
