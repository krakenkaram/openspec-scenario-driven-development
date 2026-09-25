import { test, expect, selectRepo } from "./helpers/launch";

// Group 2 — hermetic-launch-configuration: "Injected stub PATH survives under
// the e2e flag". The tracer bullet that establishes the whole harness.
test.describe("hermetic launch", () => {
  test("the injected stub PATH survives and the app reaches the stub CLIs", async ({ app }) => {
    // Selecting the repo renders its cards — proof getStatus round-tripped through
    // the real main process to core, which shelled out to `openspec`.
    await selectRepo(app, "repo-alpha");
    await expect(app.page.getByRole("heading", { name: "add-search" })).toBeVisible();

    // Direct proof of seam 2: the STUB openspec (not the real CLI) was invoked —
    // only possible if login-shell PATH resolution did not clobber our PATH.
    const log = app.readStubLog();
    expect(log).toContain("openspec status");
    expect(log).toContain("--change add-search");
  });

  test("seeded fixture changes and repos render on the board", async ({ app }) => {
    // Both repositories are listed in the sidebar regardless of selection.
    await expect(app.page.locator("[data-repo-name]", { hasText: "repo-alpha" })).toBeVisible();
    await expect(app.page.locator("[data-repo-name]", { hasText: "repo-beta" })).toBeVisible();

    // repo-alpha's changes render when it is selected...
    await selectRepo(app, "repo-alpha");
    await expect(app.page.getByRole("heading", { name: "add-search" })).toBeVisible();
    await expect(app.page.getByRole("heading", { name: "ship-export" })).toBeVisible();

    // ...and repo-beta's when it is selected.
    await selectRepo(app, "repo-beta");
    await expect(app.page.getByRole("heading", { name: "refactor-cleanup" })).toBeVisible();
  });
});
