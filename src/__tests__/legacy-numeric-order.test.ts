import { it, expect, vi } from "vitest";
import { RowPipeline } from "../data/RowPipeline";
import type { RowData, ViewConfig } from "../data/types";
import { ViewStateStore } from "../views/ViewStateStore";

vi.mock("obsidian", () => ({ TFile: class {} }));
vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: () => undefined }));
vi.mock("../data/ComputedEvaluator", () => ({ evaluateComputedFields: () => ({}) }));

it("keeps numeric behavior for a saved greater-than filter after number to text conversion", () => {
  const config: ViewConfig = { name: "Old", sourceFolder: "", schema: {
    columns: [{ key: "amount", label: "Amount", type: "text" }], computedFields: [],
  }, filters: [{ field: "amount", op: "gt", value: "10" }] };
  const records = ["5", "20"].map(amount => ({ file: { path: amount + ".md" } as RowData["file"], frontmatter: { amount } }));
  const result = new RowPipeline().build(records, config, new ViewStateStore().get(0, 0, config));
  expect(result.map(row => row.file.path)).toEqual(["20.md"]);
});
