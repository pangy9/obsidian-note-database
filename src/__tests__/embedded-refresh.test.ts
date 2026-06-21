import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("embedded database refresh behavior", () => {
  it("defers data refreshes while the embedded block is outside the viewport", () => {
    const source = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain("private hasObservedVisibility = false");
    expect(source).toContain("private pendingRefreshWhileHidden = false");
    expect(source).toContain("this.deferRefreshUntilVisible()");
    expect(source).toContain("if (visible && this.pendingRefreshWhileHidden)");
    expect(source).not.toContain("|| !wasIntersecting");
    expect(source).toContain("this.pendingRefreshWhileHidden = false");
  });
});
