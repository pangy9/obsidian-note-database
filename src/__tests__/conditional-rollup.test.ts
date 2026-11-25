import { setLocale } from "../i18n";
setLocale("en");

import { it, expect, vi } from "vitest";
import { getConditionalFormatMatch } from "../data/ConditionalFormatting";
import { getFilterOperatorsForColumn } from "../views/FilterPanelRenderer";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
import type { ColumnDef, RowData, ViewConfig } from "../data/types";

vi.mock("obsidian", () => ({ TFile: class {}, normalizePath: (v: string) => v, getAllTags: () => [], setIcon: () => {} }));

it("orders computed rollup numbers the same way in Conditional Formatting and the Filter panel", () => {
  const rollup: ColumnDef = { key: "total", label: "Total", type: "rollup", rollupConfig: { relationField: "refs", targetField: "cost", aggregation: "sum" } };
  const condition = { field: "total", op: "gt", value: "20" } as const;
  const config: ViewConfig = { name: "Board", viewType: "board", sourceFolder: "", schema: { columns: [rollup], computedFields: [] }, conditionalFormats: [{ id: "color", condition, comparison: "typed", target: "record", color: "red" }], filters: [condition] };
  const rows = [9, 100].map(n => ({ file: { name: n + ".md", path: n + ".md" }, frontmatter: {}, computed: { total: n } })) as unknown as RowData[];
  const matchingRows = new RowPipeline().build(rows, config, new ViewStateStore().get(0, 0, config), undefined, new Map(rows.map(row => [row.file.path, row.computed]))).map(row => row.file.path);
  const matchingColors = rows.filter(row => getConditionalFormatMatch(row, config, undefined)).map(row => row.file.path);
  expect(matchingColors).toEqual(matchingRows);
  expect(matchingRows).toEqual(["100.md"]);
});

it("preserves legacy formula formatting and distinguishes a typed checkbox condition", () => {
  const fields: ColumnDef[] = [{ key: "computed", label: "Computed", type: "computed", computedKey: "computed" }];
  const config: ViewConfig = { name: "Board", sourceFolder: "", schema: { columns: fields,
    computedFields: [{ key: "computed", label: "Computed", type: "checkbox", expression: "false" }] },
    conditionalFormats: [{ id: "color", condition: { field: "computed", op: "notempty" }, target: "record", color: "red" }] };
  const row: RowData = { file: { path: "Record.md" } as RowData["file"], computed: { computed: false }, frontmatter: {} };
  expect(getConditionalFormatMatch(row, config, undefined)?.ruleId).toBe("color");
  const rule = config.conditionalFormats![0];
  rule.comparison = "typed";
  expect(getConditionalFormatMatch(row, config, undefined)).toBeNull();
  rule.condition.op = "empty";
  expect(getConditionalFormatMatch(row, config, undefined)?.ruleId).toBe("color");
  rule.condition.op = "eq";
  rule.condition.value = "";
  expect(getConditionalFormatMatch(row, config, undefined)).toBeNull();
});
