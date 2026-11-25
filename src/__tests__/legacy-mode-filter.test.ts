import { expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, normalizePath: (path: string) => path }));
vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: () => undefined }));
vi.mock("../data/ComputedEvaluator", () => ({ evaluateComputedFields: () => ({}) }));
it("keeps an existing saved active-mode text-equality filter stable after upgrading", () => {
  const filters = [{ field: "code", op: "eq", value: "01" }];
  const ds = new DataSource({} as any);
  const db = ds.parseDatabaseConfig({ db_view: true, database: { id: "db", name: "DB", columns: [{key:"code", type:"text"}],
    views:[{id:"v", name:"View", viewType:"table", filters, viewStates:{table:{filters}}}] } })!;
  const view = { ...db.views[0], schema: db.schema };
  const rows = ["1","2"].map(code => ({file:{path:code+".md", name:code+".md", basename:code} as any, frontmatter:{code}}));
  const mode = new ViewStateStore().get(0,0,view);
  const matching = new RowPipeline().build(rows, view, mode).map(row=>row.file.path);
  expect(matching).toEqual(["1.md"]);
  const stored = ds.serializeDatabaseConfig(db);
  const reloaded = ds.parseDatabaseConfig({ db_view: true, database: stored })!.views[0];
  const reloadedMode = new ViewStateStore().get(0, 0, reloaded);
  expect(reloadedMode.filters[0].comparison).toBe("legacy");
  reloadedMode.filters[0].comparison = "typed";
  new ViewStateStore().persist(reloaded, reloadedMode);
  expect(new RowPipeline().build(rows, reloaded, new ViewStateStore().get(0, 0, reloaded))).toEqual([]);
});
