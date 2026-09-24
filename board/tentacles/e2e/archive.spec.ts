import { test, expect, selectRepo } from "./helpers/launch";

// Group 6 — electron-app-smoke-coverage: "A change can be archived from the board".
test.describe("archive", () => {
  test("confirming the archive modal invokes the archive path and the card disappears", async ({ app }) => {
    // refactor-cleanup lives in repo-beta; select it so the card renders.
    await selectRepo(app, "repo-beta");

    const card = app.page.locator("[data-change-card]", {
      has: app.page.getByRole("heading", { name: "refactor-cleanup" }),
    });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Archive" }).click();

    // The renderer now confirms via a Mantine modal (not window.confirm).
    const dialog = app.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /archive/i }).click();

    // The card is removed from the board (optimistic hide + re-fetch)...
    await expect(app.page.getByRole("heading", { name: "refactor-cleanup" })).toHaveCount(0);

    // ...and the archive IPC actually reached core / the CLI (stub invocation log).
    expect(app.readStubLog()).toContain("openspec archive refactor-cleanup");
  });
});
