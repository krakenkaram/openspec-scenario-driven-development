import { test, expect, selectRepo } from "./helpers/launch";

// artifact-viewing (item 4): a change with more than one capability writes one
// specs/<capability>/spec.md each. The single specs node must open a modal with
// one tab per capability; clicking a tab shows that capability's spec on its own.
test.describe("multi-capability specs", () => {
  test("the specs node shows a tab per capability and switches content on click", async ({ app }) => {
    await selectRepo(app, "repo-alpha");

    const card = app.page.locator("[data-change-card]", {
      has: app.page.getByRole("heading", { name: "ship-export" }),
    });
    await expect(card).toBeVisible();

    await card.locator('[data-phase="specs"]').click();

    const modal = app.page.locator("[role='dialog']");
    await expect(modal).toBeVisible();

    const csvTab = modal.getByRole("tab", { name: "csv-export" });
    const pdfTab = modal.getByRole("tab", { name: "pdf-export" });
    await expect(csvTab).toBeVisible();
    await expect(pdfTab).toBeVisible();

    // first tab active by default: only its spec is shown
    await expect(modal.locator(".markdown-body")).toContainText("The system exports data as CSV.");
    await expect(modal.locator(".markdown-body")).not.toContainText("The system exports data as PDF.");

    await pdfTab.click();
    await expect(modal.locator(".markdown-body")).toContainText("The system exports data as PDF.");
    await expect(modal.locator(".markdown-body")).not.toContainText("The system exports data as CSV.");
  });
});
