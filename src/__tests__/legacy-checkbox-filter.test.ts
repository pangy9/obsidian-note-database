import { expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
import type { RowData } from "../data/types";
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, normalizePath: (v:string) => v }));
const recs = [
  ["checked", { done: true }],
  ["unchecked", { done: false }],
  ["unfilled", {}],
] as const;
for (const [op, expected] of [["eq", ["unchecked.md"]], ["neq", ["checked.md","unfilled.md"]]] as const) {
  it("preserves public-version persisted checkbox " + op + " false", () => {
    const f = [{field:"done", op, value:"false"}];
    const source = new DataSource({} as any);
    const parsed = source.parseDatabaseConfig({db_view:true,database:{id:"db",name:"Work",columns:[{key:"done",label:"Done",type:"checkbox"}],views:[{id:"table",name:"Table",viewType:"table",filters:f,viewStates:{table:{filters:f}}}]}})!;
    const rec = recs.map(([name,frontmatter]) => ({file:{name:name+".md",path:name+".md",basename:name} as RowData["file"],frontmatter}));
    const filter = (db: typeof parsed) => new RowPipeline().build(rec, db.views[0], new ViewStateStore().get(0,0,db.views[0])).map(r => r.file.path);
    const roundtrip = source.parseDatabaseConfig({db_view:true,database:source.serializeDatabaseConfig(parsed)})!;
    const first = filter(parsed), reopened = filter(roundtrip);
    expect({first,reopened}).toEqual({first:expected,reopened:expected});
    roundtrip.views[0].viewStates!.table!.filters![0].comparison = "typed";
    expect(filter(roundtrip)).toEqual(op === "eq" ? ["unchecked.md", "unfilled.md"] : ["checked.md"]);
  });
}
