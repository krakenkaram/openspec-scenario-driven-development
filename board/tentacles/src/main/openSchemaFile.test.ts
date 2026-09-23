import { describe, it, expect, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { makeHandlers, type BoardCore } from "./wiring";
import type { Args } from "./core";

const EVENT = {} as IpcMainInvokeEvent;
const args = (): Args => ({ repos: [], root: "/x", depth: 1 });

describe("openSchemaFile handler (wiring)", () => {
  it("delegates to core with the schema name, repo, and injected reveal opener", async () => {
    const openSchemaFile = vi.fn().mockResolvedValue({ ok: true });
    const core = { openSchemaFile } as unknown as BoardCore;
    const reveal = vi.fn().mockResolvedValue("");
    const handlers = makeHandlers(core, args, undefined, undefined, undefined, undefined, undefined, reveal);

    expect(await handlers.openSchemaFile(EVENT, "atdd-driven", "/repo")).toEqual({ ok: true });
    expect(openSchemaFile).toHaveBeenCalledWith("atdd-driven", "/repo", reveal);
  });

  it("reports unavailable when no reveal opener is wired", async () => {
    const core = { openSchemaFile: vi.fn() } as unknown as BoardCore;
    const handlers = makeHandlers(core, args);
    expect(await handlers.openSchemaFile(EVENT, "atdd-driven", "/repo")).toEqual({
      ok: false,
      error: "reveal unavailable",
    });
  });
});
