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
});
