import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isImeComposing } from "../data/KeyboardUtils";

// IME (input method) users confirm a candidate with Enter and cancel it with
// Escape. If a text editor's keydown handler commits/closes on Enter or Escape
// without checking isComposing, those IME keys wrongly submit/close the editor,
// making CJK input unusable. Every text-entry editor must early-return while
// isImeComposing(event) is true. See INTERACTION_PATTERNS.md.

describe("isImeComposing", () => {
  it("reflects event.isComposing", () => {
    expect(isImeComposing({ isComposing: true } as KeyboardEvent)).toBe(true);
    expect(isImeComposing({ isComposing: false } as KeyboardEvent)).toBe(false);
  });
});

describe("text editors guard Enter/Escape during IME composition", () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
  const guardCount = (src: string): number => (src.match(/isImeComposing\(/g) || []).length;

  it("CellRenderer guards every cell text editor", () => {
    const src = read("../views/CellRenderer.ts");
    expect(src).toContain("import { isImeComposing }");
    // Inline cell input (handleEditKey), single-line + multiline text popovers
    // (input + textarea + their document-Escape), option rename, add-option,
    // option popover Escape, date + datetime segment handlers + datetime Escape.
    expect(guardCount(src)).toBeGreaterThanOrEqual(10);
  });

  it("ToolbarRenderer guards view-tab rename and database name/description", () => {
    const src = read("../views/ToolbarRenderer.ts");
    expect(src).toContain("import { isImeComposing }");
    expect(guardCount(src)).toBeGreaterThanOrEqual(2);
  });

  it("FilterPanelRenderer guards filter value and date-segment inputs", () => {
    const src = read("../views/FilterPanelRenderer.ts");
    expect(src).toContain("import { isImeComposing }");
    expect(guardCount(src)).toBeGreaterThanOrEqual(2);
  });

  it("FormulaModal guards suggestion/commit Enter", () => {
    const src = read("../views/modals/FormulaModal.ts");
    expect(src).toContain("import { isImeComposing }");
    expect(guardCount(src)).toBeGreaterThanOrEqual(1);
  });
});
