import { expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
vi.stubGlobal("moment", () => ({ format: () => "2026-11-25" }));

vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, normalizePath: (path: string) => path }));
vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: () => undefined }));
it("reopens an old UI-authored numeric-formula equality filter without replacing its row set", () => {
  const ds = new DataSource({} as any);
  const db = ds.parseDatabaseConfig({ db_view: true, database: {
    id: "db", name: "Invoices", columns: [{key:"amount",type:"number"},{key:"result",type:"computed",computedKey:"result"}],
    computedFields: [{key:"result",label:"Result",expression:"amount * 1",type:"number"}],
    views:[{id:"v",name:"Table",viewType:"table",filters:[{field:"result",op:"eq",value:"1e2"}]}]
  } })!;
  const view = {...db.views[0], schema: db.schema};
  const rs = [12,100].map(amount=>({file:{path:amount+".md",name:amount+".md",basename:String(amount)} as any,frontmatter:{amount}}));
  const state = new ViewStateStore().get(0,0,view);
  const all = new RowPipeline().build(rs,view,{...state,filters:[]}).map(r=>r.computed.result);
  const selected = new RowPipeline().build(rs,view,state).map(r=>r.file.path);
  expect(all).toEqual([12,100]);
  expect(selected).toEqual(["12.md"]);
  const typed = new RowPipeline().build(rs, view, {
    ...state, filters: state.filters.map(filter => ({ ...filter, comparison: "typed" as const })),
  });
  expect(typed.map(row => row.file.path)).toEqual(["100.md"]);
});
