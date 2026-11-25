import { it, expect, vi } from "vitest";
import {DataSource} from "../data/DataSource";
import {RowPipeline} from "../data/RowPipeline";
import {ViewStateStore} from "../views/ViewStateStore";
import type {App} from "obsidian";
import type {RowData, DatabaseConfig} from "../data/types";
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, Notice: class {}, normalizePath: (p: string) => p }));
vi.mock("../data/FileFieldObsidian", () => ({getRowFileFieldValue: () => undefined}));
it("legacy settings-to-note migration preserves the prior text EQ results", () => {
  const schema = {columns:[{key:"serial",label:"Serial",type:"text" as const}],computedFields:[]};
  const before: DatabaseConfig = {id:"old",name:"Old",sourceFolder:"",schema,views:[{id:"table",viewType:"table",name:"Table",sourceFolder:"",schema,filters:[{field:"serial",op:"eq",value:"001"}]}]};
  const ds = new DataSource({} as App);
  // use the same serializer as createViewDefFile, followed by the same reload parser:
  const payload = ds.serializeDatabaseConfig(before);
  const after = ds.parseDatabaseConfig({db_view:true,database:payload})!;
  const view = after.views[0];
  const records = ["001","1","2"].map(serial => ({file:{path:serial+".md",name:serial+".md"} as RowData["file"],frontmatter:{serial}}));
  const matched = new RowPipeline().build(records,view,new ViewStateStore().get(0,0,view)).map(row=>row.file.path);
  expect(matched).toEqual(["001.md","1.md"]);
});
