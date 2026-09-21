import { describe, it, expect, vi } from "vitest";
import type { App, BrowserWindow, IpcMain } from "electron";
import { bootstrap, type BoardCore, type BootstrapDeps } from "./wiring";
import type { Args } from "./core";

function fakeApp() {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  return {
    on(ev: string, fn: (...a: unknown[]) => void) {
      (listeners[ev] ||= []).push(fn);
    },
    emit(ev: string, ...a: unknown[]) {
      (listeners[ev] || []).forEach((fn) => fn(...a));
    },
    quit: vi.fn(),
  };
}

// FakeBrowserWindow tracks live instances so getAllWindows() reflects reality.
// `alwaysEmpty` models the "no window currently open" case (e.g. after close).
function makeFakeBrowserWindow({ order = [] as string[], alwaysEmpty = false } = {}) {
  const instances: FakeBrowserWindow[] = [];
  class FakeBrowserWindow {
    loadFile = vi.fn();
    webContents = { setWindowOpenHandler: vi.fn() };
    private _visible = true;
    private listeners: Record<string, (...a: unknown[]) => void> = {};
    show = vi.fn(() => {
      this._visible = true;
    });
    hide = vi.fn(() => {
      this._visible = false;
    });
    focus = vi.fn();
    isVisible = () => this._visible;
    on = vi.fn((ev: string, fn: (...a: unknown[]) => void) => {
      this.listeners[ev] = fn;
    });
    fire(ev: string, ...a: unknown[]) {
      this.listeners[ev]?.(...a);
    }
    constructor(public opts: unknown) {
      instances.push(this);
      order.push("window");
    }
    static getAllWindows() {
      return alwaysEmpty ? [] : instances;
    }
  }
  return { FakeBrowserWindow, instances };
}

// Fake Tray/Menu/nativeImage collaborators for the darwin tray wiring.
function makeFakeTray() {
  const instances: FakeTray[] = [];
  class FakeTray {
    title = "";
    contextMenu: unknown = null;
    private listeners: Record<string, (...a: unknown[]) => void> = {};
    constructor(public image: unknown) {
      instances.push(this);
    }
    setTitle(t: string) {
      this.title = t;
    }
    setContextMenu(m: unknown) {
      this.contextMenu = m;
    }
    destroy = vi.fn();
    on(ev: string, fn: (...a: unknown[]) => void) {
      this.listeners[ev] = fn;
    }
    fire(ev: string, ...a: unknown[]) {
      this.listeners[ev]?.(...a);
    }
  }
  return { FakeTray, instances };
}

type MenuItem = { label: string; click?: () => void };
function makeFakeMenu() {
  const built: MenuItem[][] = [];
  const FakeMenu = {
    buildFromTemplate(template: MenuItem[]) {
      built.push(template);
      return { template };
    },
  };
  return { FakeMenu, built };
}

const fakeNativeImage = { createEmpty: () => ({}) };

// Bundles the fake tray collaborators as bootstrap deps (cast to the Electron
// constructor types they stand in for).
function trayDeps(t: ReturnType<typeof makeFakeTray>, m: ReturnType<typeof makeFakeMenu>) {
  return {
    Tray: t.FakeTray as unknown as BootstrapDeps["Tray"],
    Menu: m.FakeMenu as unknown as BootstrapDeps["Menu"],
    nativeImage: fakeNativeImage as unknown as BootstrapDeps["nativeImage"],
  };
}

const deps = (over: Partial<BootstrapDeps> = {}): BootstrapDeps =>
  ({
    core: {
      getStatus: () => Promise.resolve({} as never),
      readArtifact: () => ({}) as never,
      archiveChange: () => Promise.resolve({} as never),
    } as unknown as BoardCore,
    getArgs: () => ({ repos: [], root: "/x", depth: 30 }) as Args,
    windowOpts: { preloadPath: "/p", indexPath: "/i" },
    platform: "darwin",
    resolvePath: vi.fn(async () => {}),
    ...over,
  }) as BootstrapDeps;

describe("bootstrap startup coordinator", () => {
  it("registers IPC and resolves PATH before opening the one window", async () => {
    const app = fakeApp();
    const order: string[] = [];
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow({ order });
    const ipcMain = { handle: () => order.push("ipc") };
    const resolvePath = vi.fn(async () => {
      order.push("path");
    });

    await bootstrap({
      ...deps({ resolvePath }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: ipcMain as unknown as IpcMain,
    });

    expect(instances).toHaveLength(1);
    expect(order.filter((x) => x === "ipc")).toHaveLength(14); // fourteen channels
    expect(order.indexOf("window")).toBeGreaterThan(order.lastIndexOf("ipc"));
    expect(order.indexOf("window")).toBeGreaterThan(order.indexOf("path"));
  });

  it("ignores an activate that fires during startup and never opens a second window", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow();
    let release: () => void = () => {};
    const resolvePath = () => new Promise<void>((r) => (release = r));

    const pending = bootstrap({
      ...deps({ resolvePath }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });

    app.emit("activate"); // fires while PATH resolution is pending
    expect(instances).toHaveLength(0); // no premature window

    release();
    await pending;
    expect(instances).toHaveLength(1);

    app.emit("activate"); // re-activation with the window still open → idempotent
    expect(instances).toHaveLength(1);
  });

  it("re-creates a window on activate after startup when none are open", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow({ alwaysEmpty: true });

    await bootstrap({
      ...deps(),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });
    expect(instances).toHaveLength(1);

    app.emit("activate"); // getAllWindows() reports none → create one
    expect(instances).toHaveLength(2);
  });

  it("stays resident on window-all-closed on darwin", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow } = makeFakeBrowserWindow();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });
    app.emit("window-all-closed");
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("quits on window-all-closed on non-darwin platforms", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow } = makeFakeBrowserWindow();
    await bootstrap({
      ...deps({ platform: "linux" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });
    app.emit("window-all-closed");
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it("does not prevent or hide window close on non-darwin platforms", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow();
    await bootstrap({
      ...deps({ platform: "linux" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });

    const win = instances[0];
    const event = { preventDefault: vi.fn() };
    win.fire("close", event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });
});

describe("macOS minimise-on-close-to-tray wiring", () => {
  it("hides the window on close instead of destroying it while not quitting (darwin)", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });

    const win = instances[0];
    const event = { preventDefault: vi.fn() };
    win.fire("close", event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
    expect(instances).toHaveLength(1);
  });

  it("lets the window close and does not hide it once an explicit quit is under way (darwin)", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });

    app.emit("before-quit");
    const win = instances[0];
    const event = { preventDefault: vi.fn() };
    win.fire("close", event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("re-shows and focuses the existing hidden window on activate, creating no second window (darwin)", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
    });

    const win = instances[0];
    win.hide();
    win.show.mockClear();
    win.focus.mockClear();

    app.emit("activate");

    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
  });

  it("creates exactly one tray with a non-empty title on darwin", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow } = makeFakeBrowserWindow();
    const tray = makeFakeTray();
    const menu = makeFakeMenu();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
      ...trayDeps(tray, menu),
    });

    expect(tray.instances).toHaveLength(1);
    expect(tray.instances[0].title.length).toBeGreaterThan(0);
  });

  it("creates no tray on non-darwin platforms", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow } = makeFakeBrowserWindow();
    const tray = makeFakeTray();
    const menu = makeFakeMenu();
    await bootstrap({
      ...deps({ platform: "linux" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
      ...trayDeps(tray, menu),
    });

    expect(tray.instances).toHaveLength(0);
  });

  it("toggles the window on tray left-click: shows when hidden, hides when visible (darwin)", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow();
    const tray = makeFakeTray();
    const menu = makeFakeMenu();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
      ...trayDeps(tray, menu),
    });

    const win = instances[0];
    win.hide();
    win.show.mockClear();
    win.focus.mockClear();

    tray.instances[0].fire("click"); // hidden → show + focus
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);

    win.hide.mockClear();
    tray.instances[0].fire("click"); // now visible → hide
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it("builds a tray context menu with Show and Quit; Show re-shows and Quit quits (darwin)", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindow();
    const tray = makeFakeTray();
    const menu = makeFakeMenu();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
      ...trayDeps(tray, menu),
    });

    const template = menu.built[0];
    const labels = template.map((i) => i.label);
    expect(labels).toContain("Show Tentacles");
    expect(labels).toContain("Quit Tentacles");
    expect(tray.instances[0].contextMenu).not.toBeNull();

    const win = instances[0];
    win.hide();
    win.show.mockClear();
    template.find((i) => i.label === "Show Tentacles")?.click?.();
    expect(win.show).toHaveBeenCalledTimes(1);

    template.find((i) => i.label === "Quit Tentacles")?.click?.();
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it("destroys the tray on before-quit (darwin)", async () => {
    const app = fakeApp();
    const { FakeBrowserWindow } = makeFakeBrowserWindow();
    const tray = makeFakeTray();
    const menu = makeFakeMenu();
    await bootstrap({
      ...deps({ platform: "darwin" }),
      app: app as unknown as App,
      BrowserWindow: FakeBrowserWindow as unknown as typeof BrowserWindow,
      ipcMain: { handle() {} } as unknown as IpcMain,
      ...trayDeps(tray, menu),
    });

    app.emit("before-quit");

    expect(tray.instances[0].destroy).toHaveBeenCalledTimes(1);
  });
});