import { expect, it, vi } from "vitest";
import { getFilterOperatorsForColumn } from "../data/FilterRules";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
import { setLocale } from "../i18n";
setLocale("en");
import type { ViewConfig, RowData } from "../data/types";
vi.mock("obsidian", () => ({ TFile: class {} }));
vi.stubGlobal("moment", () => ({ format: () => "2026-11-25" }));
const config: ViewConfig = {
  name: "Calc", sourceFolder: "",
  schema: {
    columns: [{key: "amount", label: "Amount", type: "number"}, { key: "scaled", label: "Scaled", type: "computed", computedKey: "scaled" }],
    computedFields: [{ key: "scaled", label: "Scaled", expression: "amount * 1", type: "number" }],
  },
};
const records = [0.0000001, 20, 100, 200].map(amount => ({
  file: { path: `${amount}.md`, name: `${amount}.md`, basename: String(amount) } as unknown as RowData["file"],
  frontmatter: { amount },
}));
it("uses the same numeric values for newly available formula filter comparisons", () => {
  const state = new ViewStateStore().get(0, 0, config);
  const pipeline = new RowPipeline();
  const rows = () => pipeline.build(records, config, state).map(r => r.computed.scaled);
  const all = rows();
  expect(all).toEqual([1e-7, 20, 100, 200]);
  expect(getFilterOperatorsForColumn(config.schema.columns[1], config.schema.computedFields).map(([op]) => op)).toContain("gt");
  state.filters = [{ field: "scaled", op: "gt", value: "0" }];
  const positive = rows();
  state.filters = [{ field: "scaled", op: "gt", value: "1e2" }];
  const aboveHundred = rows();
  expect({positive, aboveHundred}).toEqual({positive: all, aboveHundred: [200]});
});
