import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Keep both user-facing entry points on the creation dialog. A build from an
// older baseline silently brought back direct creation of a default text column.
const view = readFileSync(join(__dirname, "../views/DatabaseView.ts"), "utf8");

describe("property creation entry points", () => {
  it("opens the property dialog when inserting beside an existing column", () => {
    expect(view).toMatch(/insertColumn:\s*\(col, side\)\s*=>\s*\{\s*void this\.openCreatePropertyModal\(\{ nearCol: col, side \}\)/);
    expect(view).not.toMatch(/insertColumn:[^\n]*columnOperations\.insertColumnNear/);
  });

  it("opens the same dialog from the column manager", () => {
    expect(view).toMatch(/addColumn:\s*\(\)\s*=>\s*\{\s*void this\.openCreatePropertyModal\(\)/);
    expect(view).not.toMatch(/addColumn:[^\n]*columnOperations\.appendColumn/);
  });
});
