import { expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
vi.stubGlobal("moment", () => ({ format: () => "2026-11-25" }));
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, normalizePath: (path: string) => path }));
vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: () => undefined }));
it("opens a 1.3.3 view filtering a declared checkbox formula with is empty", () => {
  const db = new DataSource({} as any).parseDatabaseConfig({ db_view: true, database: {
    id:"db", name:"Invoices",
    columns: [{ key:"amount", type:"number" }, { key:"paid", type:"computed", computedKey:"paid" }],
    computedFields:[{ key:"paid", label:"Paid", type:"checkbox", expression:"amount > 10" }],
    views:[{ id:"v", name:"Table", viewType:"table", filters:[{field:"paid", op:"empty"}] }],
  } })!;
  const view = { ...db.views[0], schema: db.schema };
  const records = [5, 20].map(amount => ({
    file: { path: amount + ".md", name: amount + ".md", basename: String(amount) } as any,
    frontmatter: {amount},
  }));
  const state = new ViewStateStore().get(0, 0, view);
  const pipeline = new RowPipeline();
  expect(pipeline.build(records, view, {...state, filters:[]}).map(row => row.computed.paid)).toEqual([false,true]);
  expect(pipeline.build(records, view, state).map(row => row.file.path)).toEqual(["5.md"]);
});
