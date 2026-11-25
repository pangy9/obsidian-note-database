import { expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { setLocale } from "../i18n";
import type { App } from "obsidian";
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, Modal: class {}, Notice: class {}, normalizePath: (path: string) => path }));
setLocale("en");
it("preserves the effective empty-field visibility in a saved legacy gallery", () => {
  const source = new DataSource({} as App);
  const parsed = source.parseDatabaseConfig({db_view:true,database:{ id:"DB",name:"Legacy",columns:[{key:"topic",label:"Topic",type:"text"}],
    views:[{id:"v1",name:"Gallery",viewType:"gallery",showEmptyFields:false,alwaysShowEmptyFields:["topic"]}] }})!;
  const actual = parsed.views[0].showEmptyFields;
  expect(actual).toBe(true);
});
