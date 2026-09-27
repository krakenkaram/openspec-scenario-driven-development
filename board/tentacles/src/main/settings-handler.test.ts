import { describe, it, expect } from "vitest";
import { makeHandlers, type BoardCore, type SettingsDeps } from "./wiring";
import type { Args, Settings } from "./core";

const args: Args = { repos: [], root: "/Code", depth: 30 };
const noCore = {} as unknown as BoardCore;

// The seeded assignment getSettings resolves to when nothing valid is stored.
const DEFAULT_ASSIGN = { feature: "atdd-driven", refactor: "refactor", testing: null };

function fakeSettings(initial: Settings, isDir: (p: string) => boolean = () => true) {
  let stored: Settings = { ...initial };
  let root = initial.root ?? "/Code";
  const deps: SettingsDeps = {
    read: () => stored,
    write: (s: Settings) => {
      stored = s;
    },
    getRoot: () => root,
    setRoot: (r: string) => {
      root = r;
    },
    isDir,
    home: "/Users/tester",
  };
  return {
    deps,
    written: () => stored,
    liveRoot: () => root,
  };
}

describe("settings IPC handlers — notification preference", () => {
  it("getSettings returns the persisted notification preference", () => {
    const s = fakeSettings({ root: "/Code", notifications: "muted" });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);
    expect(handlers.getSettings()).toEqual({
      root: "/Code",
      notifications: "muted",
      targets: [],
      schemaAssignment: DEFAULT_ASSIGN,
    });
  });

  it("getSettings defaults the preference to enabled when unset", () => {
    const s = fakeSettings({ root: "/Code" });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);
    expect(handlers.getSettings()).toEqual({
      root: "/Code",
      notifications: "enabled",
      targets: [],
      schemaAssignment: DEFAULT_ASSIGN,
    });
  });

  it("setSettings persists both the validated root and the chosen preference", () => {
    const s = fakeSettings({ root: "/old", notifications: "enabled" });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);

    const res = handlers.setSettings(undefined as never, { root: "/new", notifications: "silent" });

    expect(res).toEqual({
      ok: true,
      root: "/new",
      notifications: "silent",
      targets: [],
      schemaAssignment: DEFAULT_ASSIGN,
    });
    expect(s.written()).toEqual({ root: "/new", notifications: "silent", targets: [], schemaAssignment: {} });
    expect(s.liveRoot()).toBe("/new");
  });

  it("setSettings preserves the existing preference when the payload omits it", () => {
    const s = fakeSettings({ root: "/old", notifications: "muted" });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);

    const res = handlers.setSettings(undefined as never, { root: "/new" });

    expect(res).toEqual({
      ok: true,
      root: "/new",
      notifications: "muted",
      targets: [],
      schemaAssignment: DEFAULT_ASSIGN,
    });
    expect(s.written()).toEqual({ root: "/new", notifications: "muted", targets: [], schemaAssignment: {} });
  });

  it("setSettings rejects an invalid root and writes nothing", () => {
    const s = fakeSettings({ root: "/old", notifications: "muted" }, () => false);
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);

    const res = handlers.setSettings(undefined as never, { root: "/nope", notifications: "silent" });

    expect(res.ok).toBe(false);
    expect(s.written()).toEqual({ root: "/old", notifications: "muted" });
    expect(s.liveRoot()).toBe("/old");
  });
});

describe("settings IPC handlers — schema assignment", () => {
  it("getSettings returns the seeded defaults when no assignment is stored", () => {
    const s = fakeSettings({ root: "/Code" });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);
    expect(handlers.getSettings().schemaAssignment).toEqual({
      feature: "atdd-driven",
      refactor: "refactor",
      testing: null,
    });
  });

  it("setSettings persists a changed assignment and getSettings reads it back", () => {
    const s = fakeSettings({ root: "/Code" });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);

    const res = handlers.setSettings(undefined as never, {
      root: "/Code",
      schemaAssignment: { feature: "refactor", refactor: "refactor", testing: null },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.schemaAssignment).toEqual({ feature: "refactor", refactor: "refactor", testing: null });
    }
    expect(handlers.getSettings().schemaAssignment).toEqual({
      feature: "refactor",
      refactor: "refactor",
      testing: null,
    });
  });

  it("setSettings can set a work type to None (null)", () => {
    const s = fakeSettings({ root: "/Code" });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);

    handlers.setSettings(undefined as never, {
      root: "/Code",
      schemaAssignment: { feature: null, refactor: "refactor", testing: null },
    });

    expect(handlers.getSettings().schemaAssignment.feature).toBeNull();
  });

  it("setSettings preserves the stored assignment when the payload omits it", () => {
    const s = fakeSettings({ root: "/Code", schemaAssignment: { refactor: null } });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);

    handlers.setSettings(undefined as never, { root: "/Code" });

    const a = handlers.getSettings().schemaAssignment;
    expect(a.refactor).toBeNull();
    expect(a.feature).toBe("atdd-driven");
  });

  it("getSettings resolves a malformed stored assignment to a clean mapping", () => {
    const s = fakeSettings({
      root: "/Code",
      // an unknown work type and an invalid (non-string, non-null) value
      schemaAssignment: { bogus: "x", feature: 123 } as never,
    });
    const handlers = makeHandlers(noCore, () => args, undefined, s.deps);

    const a = handlers.getSettings().schemaAssignment;
    expect(a).toEqual({ feature: "atdd-driven", refactor: "refactor", testing: null });
    expect(Object.keys(a).sort()).toEqual(["feature", "refactor", "testing"]);
  });
});
