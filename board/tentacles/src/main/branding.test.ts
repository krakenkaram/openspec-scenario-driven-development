import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

describe("branding — product identity", () => {
  it("presents the product as Tentacles while keeping the application id", () => {
    expect(pkg.productName).toBe("Tentacles");
    expect(pkg.build.productName).toBe("Tentacles");
    expect(pkg.build.appId).toBe("dev.openspec.board");
  });

  it("configures the macOS build with the octopus icon and ships the asset", () => {
    expect(pkg.build.mac.icon).toBe("icons/icon.icns");
    expect(fs.existsSync(path.join(process.cwd(), pkg.build.mac.icon))).toBe(true);
  });

  it("bundles the tray icon (and its @2x) as extra resources", () => {
    const froms = (pkg.build.extraResources as Array<{ from: string }>).map((r) => r.from);
    expect(froms).toContain("icons/tray.png");
    expect(froms).toContain("icons/tray@2x.png");
    expect(fs.existsSync(path.join(process.cwd(), "icons/tray.png"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "icons/tray@2x.png"))).toBe(true);
  });
});
