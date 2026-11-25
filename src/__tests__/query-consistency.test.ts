import { describe, expect, it, vi } from "vitest";
import { QueryEngine } from "../data/QueryEngine";
import { getFilterOperatorsForColumn } from "../data/FilterRules";
import { getQueryColumns } from "../data/QueryColumns";
import { RowPipeline } from "../data/RowPipeline";
import { setLocale } from "../i18n";
import type { ColumnDef, ComputedFieldDef, RowData, ViewConfig } from "../data/types";
import { ViewStateStore } from "../views/ViewStateStore";
vi.mock("obsidian", () => ({ TFile: class {} }));
vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: (r: RowData, k: string) => k === "file.name" ? r.file.name : undefined }));
vi.mock("../data/ComputedEvaluator", () => ({ evaluateComputedFields: () => ({}) }));
setLocale("en");
const engine = new QueryEngine();
const row = (value: unknown, path = String(value)): RowData => ({ file: { path, name: path, basename: path } as RowData["file"], frontmatter: { value }, computed: {} });
const column = (type: ColumnDef["type"]): ColumnDef => ({ key: "value", label: "Value", type });
describe("typed query consistency", () => {
  it.each([["A10", "B10"], ["001", "1"], ["item-1", "item1"]])("preserves text identity for %s and %s", (a, b) => {
    const rows = [row(a), row(b)];
    expect(engine.applyFilters(rows, [{ field: "value", op: "eq", value: a }], "and", [column("text")])).toEqual([rows[0]]);
    expect(engine.applyFilters(rows, [{ field: "value", op: "neq", value: a }], "and", [column("text")])).toEqual([rows[1]]);
  });
  it("still compares declared numeric values numerically", () => {
    const rows = [row("001"), row(1), row(10)];
    expect(engine.applyFilters(rows, [{ field: "value", op: "eq", value: "1" }], "and", [column("number")])).toEqual(rows.slice(0, 2));
    expect(engine.sort(rows, column("number"), "desc")).toEqual([rows[2], rows[0], rows[1]]);
  });
  it.each([true, "true", "on", "是", 1, 2])("treats %s consistently as checked", value => {
    const checked = row(value, "checked"), unchecked = row(false, "unchecked");
    expect(engine.applyFilters([checked], [{ field: "value", op: "notempty" }], "and", [column("checkbox")])).toEqual([checked]);
    expect(engine.sort([checked, unchecked], column("checkbox"), "asc")).toEqual([unchecked, checked]);
    expect(engine.sortByRules([checked, unchecked], [column("checkbox")], [{ field: "value", direction: "asc" }])).toEqual([unchecked, checked]);
    expect(engine.groupBy([checked], "value", [], column("checkbox"))[0].key).toBe("true");
  });
  it.each([false, "false", "", null, undefined, 0])("treats %s consistently as unchecked", value => {
    const entry = row(value);
    expect(engine.applyFilters([entry], [{ field: "value", op: "empty" }], "and", [column("checkbox")])).toEqual([entry]);
    expect(engine.groupBy([entry], "value", [], column("checkbox"))[0].key).toBe("false");
  });
  it.each<ComputedFieldDef["type"]>(["date", "datetime", "number", "checkbox", "text"])("uses declared formula %s result operators", type => {
    const fields: ComputedFieldDef[] = [{ key: "result", label: "Result", expression: "value", type }];
    expect(getFilterOperatorsForColumn({ key: "result-col", label: "Result", type: "computed", computedKey: "formula.result" }, fields)).toEqual(getFilterOperatorsForColumn({ key: "result-col", label: "Result", type }));
  });
  it("offers numeric comparisons for numeric rollups", () => {
    const col: ColumnDef = { key: "total", label: "Total", type: "rollup", rollupConfig: { relationField: "links", targetField: "value", aggregation: "sum" } };
    expect(getFilterOperatorsForColumn(col).map(([op]) => op)).toContain("gte");
  });
  it("executes a file name filter when name is absent from the schema", () => {
    const config: ViewConfig = { name: "Test", sourceFolder: "", schema: { columns: [column("text")], computedFields: [] }, filters: [{ field: "file.name", op: "contains", value: "apple" }] };
    expect(getQueryColumns(config).map(col => col.key)).toEqual(["file.name", "value"]);
    const records = [row("x", "apple.md"), row("y", "banana.md")].map(r => ({ file: r.file, frontmatter: r.frontmatter }));
    expect(new RowPipeline().build(records, config, new ViewStateStore().get(0, 0, config)).map(r => r.file.path)).toEqual(["apple.md"]);
  });
  it("does not duplicate explicit file.name or offer buttons", () => {
    const config: ViewConfig = { name: "Test", sourceFolder: "", schema: { columns: [{ key: "file.name", label: "Name", type: "text" }, { key: "button", label: "Run", type: "button" }], computedFields: [] } };
    expect(getQueryColumns(config).map(col => col.key)).toEqual(["file.name"]);
  });
});

it("preserves the legacy checkmark spelling in checkbox filters", () => {
  const engine = new QueryEngine();
  const cols = [column("checkbox")];
  const rows = [row("✓", "yes.md"), row(false, "no.md")];
  for (const [op, match] of [["eq", "yes.md"], ["neq", "no.md"], ["notempty", "yes.md"], ["empty", "no.md"]] as const) {
    expect(engine.applyFilters(rows, [{ field: "value", op, value: "true" }], "and", cols).map(r => r.file.path)).toEqual([match]);
  }
});

it("preserves literal legacy text filters when a field is now a checkbox", () => {
  const checked = row("yes", "yes.md"), differentlySpelled = row(true, "true.md"), unchecked = row(false, "no.md");
  const rows = [checked, differentlySpelled, unchecked];
  const cols = [column("checkbox")];
  expect(engine.applyFilters(rows, [{ field: "value", op: "contains", value: "yes" }], "and", cols)).toEqual([checked]);
  expect(engine.applyFilters(rows, [{ field: "value", op: "eq", value: "true" }], "and", cols)).toEqual([checked, differentlySpelled]);
});
