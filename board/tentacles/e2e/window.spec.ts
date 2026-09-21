import { test, expect } from "./helpers/launch";

// Group 3 — electron-app-smoke-coverage: "The app launches as a single secure window".
test.describe("single secure window", () => {
  test("boots to exactly one window", async ({ app }) => {
    const count = await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(count).toBe(1);
  });

  test("the window uses the secure renderer posture", async ({ app }) => {
    const prefs = await app.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win?.webContents.getLastWebPreferences() ?? null;
    });
    expect(prefs?.contextIsolation).toBe(true);
    expect(prefs?.nodeIntegration).toBe(false);
    expect(prefs?.sandbox).toBe(true);
  });

  // Under the e2e harness (TENTACLES_E2E) the window must launch hidden so the
  // app never pops a window that steals the developer's keyboard focus mid-run.
  // Asserted through the Electron seam so deleting the production wiring in
  // main.ts fails here rather than silently reintroducing focus stealing.
  test("launches hidden so it never steals focus", async ({ app }) => {
    const visible = await app.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.isVisible()
    );
    expect(visible).toBe(false);
  });
});

// minimise-on-close-to-tray: on macOS, 'x' hides the window (keeps it alive)
// rather than destroying it, and reopening (Dock activate) re-shows the same
// window. Asserted through the real Electron seam per ADR-0003. These drive the
// window-lifecycle capability's two e2e scenarios.
test.describe("close-to-hide window lifecycle (macOS)", () => {
  test("closing the window hides it instead of destroying it", async ({ app }) => {
    const state = await app.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.show();
      win?.close(); // 'x' — the close handler must preventDefault + hide, not destroy
      return {
        count: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0]?.isVisible() ?? null,
      };
    });
    expect(state.count).toBe(1); // still alive — not destroyed
    expect(state.visible).toBe(false); // hidden
  });

  test("Dock activation re-shows and focuses the existing hidden window", async ({ app }) => {
    const state = await app.electronApp.evaluate(({ app: electronApp, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.show();
      win?.close(); // hide it first
      electronApp.emit("activate"); // Dock click
      return {
        count: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0]?.isVisible() ?? null,
      };
    });
    expect(state.count).toBe(1); // no second window created
    expect(state.visible).toBe(true); // re-shown
  });
});