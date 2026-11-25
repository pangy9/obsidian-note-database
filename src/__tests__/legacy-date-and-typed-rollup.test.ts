import { expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { RowPipeline } from "../data/RowPipeline";
import { QueryEngine } from "../data/QueryEngine";
import { getConditionalFormatMatch } from "../data/ConditionalFormatting";
import { ViewStateStore } from "../views/ViewStateStore";
import type { ColumnDef, ViewConfig } from "../data/types";
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, normalizePath: (path: string) => path }));
vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: () => undefined }));
vi.stubGlobal("moment", () => ({ format: () => "2026-11-25" }));
const records = [
  {amount: 9, scheduled: "2026-11-25T08:00"},
  {amount: 100, scheduled: "2026-11-26T08:00"},
  {amount: 20, scheduled: "2026-11-25T18:00"},
].map(frontmatter => ({file: {path: frontmatter.amount + ".md", name: frontmatter.amount + ".md", basename: String(frontmatter.amount)} as any, frontmatter}));
function getView(field: string, op: string, value?: string, comparison?: string): ViewConfig {
  const db = new DataSource({} as any).parseDatabaseConfig({db_view: true, database: {
    id: "db", name: "Audit",
    columns: [
      {key: "amount", type: "number"}, {key: "scheduled", type: "text"},
      {key: "day", type: "computed", computedKey: "day"},
      {key: "checked", type: "computed", computedKey: "checked"},
      {key: "total", type: "rollup", rollupConfig: {relationField: "refs", targetField: "amount", aggregation: "sum"}},
    ],
    computedFields: [
      {key:"day", label:"Day", type:"date", expression:"scheduled"},
      {key:"checked", label:"Checked", type:"checkbox", expression:"amount > 10"},
    ],
    views:[{id:"v", name:"Table", viewType:"table", filters:[{field,op,value,comparison}]}],
  }})!;
  return {...db.views[0], schema: db.schema};
}
it("legacy date-return formula filter matches time-bearing values on the date selected in 1.3.3", () => {
  const view = getView("day", "eq", "2026-11-25");
  const state = new ViewStateStore().get(0, 0, view);
  const build = new RowPipeline();
  expect(build.build(records, view, {...state, filters:[]}).map(row => row.computed.day)).toEqual(records.map(row => row.frontmatter.scheduled));
  expect(build.build(records, view, state).map(row => row.file.path)).toEqual(["9.md","20.md"]);
});
it("candidate typed rollup filter, filter formatting, numeric sort and formula checkbox grouping share evaluated values", () => {
  const view = getView("total", "gt", "10", "typed");
  const state = new ViewStateStore().get(0, 0, view);
  state.sortRules = [{field:"total",direction:"asc"}];
  const condition = {...state.filters[0]};
  view.conditionalFormats = [{id:"test", condition, comparison:"typed", target:"record", color:"red"}];
  const pipeline = new RowPipeline();
  const values = new Map(records.map(row => [row.file.path, {total: row.frontmatter.amount}]));
  const unfiltered = pipeline.build(records, view, {...state, filters:[]}, undefined, values);
  const selected = pipeline.build(records, view, state, undefined, values);
  expect(unfiltered.map(row => row.computed.total)).toEqual([9,20,100]);
  expect(selected.map(row => row.file.path)).toEqual(["20.md", "100.md"]);
  expect(unfiltered.filter(row => getConditionalFormatMatch(row, view, undefined)).map(row => row.file.path)).toEqual(["20.md","100.md"]);
  const col = view.schema.columns.find(c => c.key === "checked") as ColumnDef;
  expect(new QueryEngine().groupBy(unfiltered, "checked", [], col, view).map(group => [group.key, group.rows.map(row => row.file.path)])).toEqual([["true",["20.md","100.md"]],["false",["9.md"]]]);
});
