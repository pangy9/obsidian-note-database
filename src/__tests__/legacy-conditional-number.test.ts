import { it, expect, vi } from "vitest";
import { getConditionalFormatMatch } from "../data/ConditionalFormatting";
import type { RowData, ViewConfig } from "../data/types";
vi.mock("obsidian", () => ({ TFile: class {}, normalizePath: (s: string) => s, getAllTags: () => [] }));
it("does not change the outcome of a condition already saved before typed comparisons", () => {
  const config: ViewConfig = { name: "Table", sourceFolder: "", schema: {
    columns: [{ key: "result", label: "Result", type: "computed", computedKey: "result" }],
    computedFields: [{ key: "result", label: "Result", type: "number", expression: "1" }],
  }, conditionalFormats: [{ id: "color", condition: { field: "result", op: "eq", value: "1.0" }, target: "record", color: "red" }] };
  const row: RowData = { file: { path: "Record.md" } as RowData["file"], computed: { result: 1 }, frontmatter: {} };
  expect(getConditionalFormatMatch(row, config, undefined)?.color).toBe("red");
});

it.each([
  { field: "score", type: "number", input: 50, op: "gte", value: "1e3" },
  { field: "done", type: "checkbox", input: "on", op: "empty", value: "" },
] as const)("preserves legacy $type conditions without rolling back new filter semantics", ({ field, type, input, op, value }) => {
  const config: ViewConfig = { name: "Table", sourceFolder: "", schema: { columns: [{ key: field, label: field, type }], computedFields: [] },
    conditionalFormats: [{ id: "color", condition: { field, op, value }, target: "record", color: "red" }] };
  const row: RowData = { file: { path: "Record.md" } as RowData["file"], computed: {}, frontmatter: { [field]: input } };
  expect(getConditionalFormatMatch(row, config, undefined)?.color).toBe("red");
  config.conditionalFormats![0].comparison = "typed";
  expect(getConditionalFormatMatch(row, config, undefined)).toBeNull();
});
