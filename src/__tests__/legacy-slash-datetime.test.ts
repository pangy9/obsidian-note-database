import { expect, it, vi } from "vitest";
import Plugin from "../main";
import { setLocale } from "../i18n";

import { DataSource } from "../data/DataSource";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
import type { DatabaseConfig } from "../data/types";
vi.mock("obsidian", () => ({
  Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {},
  FileView: class {}, MarkdownRenderChild: class {}, Component: class {}, Scope: class {},
  Modal: class {}, MarkdownView: class {}, TFile: class {}, TFolder: class {},
  Platform: { isMobile: false }, normalizePath(path: string) { return path; },
  Notice: class {}, stringifyYaml: (value: unknown) => JSON.stringify(value),
}));
vi.mock("../views/modals/BaseImportConfirmModal", () => ({
  BaseImportConfirmModal: class {
    constructor(_: unknown, private columns: unknown[]) {}
    async openAndWait() { return this.columns; }
  },
}));
setLocale("en");

it("preserves the local afternoon hour in the real CSV import entry point", async () => {
  const fs = new Map();
  const app = { vault: {
    getFiles: () => [],
    getAbstractFileByPath: (path: string) => fs.get(path),
    createFolder: async (path: string) => { fs.set(path, {}); },
    create: async (path: string, text: string) => { fs.set(path, text); return {path}; },
  } };
  const dataSource = {
    getViewDefFiles: () => [], openNote: () => {},
    createViewDefFile: async (_folder: string, _name: string, config: DatabaseConfig) => {
      fs.set("schema", config.schema);
      return {path:"Events.md"};
    },
  };
  const plugin = Object.assign(Object.create(Plugin.prototype), {
    settings: { databaseFolder: "Definitions" }, app, dataSource,
    confirmNewDatabasePropertyTypeConflicts: async () => true, saveSettings: async () => {},
  });
  await plugin.importFromCsvs({
    csvFiles: [{ name: "Events.csv", text: async () => "Name,starts\nEvening,2026/11/25 8:30 PM\n" }],
    markdownFiles: [], databaseName: "Events", targetFolder: "Events records",
  }, null);
  const actual = JSON.parse(fs.get("Events records/Evening.md").split("\n")[1]);
  expect(actual).toEqual({starts: "2026-11-25T20:30"});
});
it("preserves an existing Datetime filter selecting local evening notes", () => {
  const ds = new DataSource({} as any);
  const db = ds.parseDatabaseConfig({db_view: true, database: {
    id: "events", name: "Events", columns: [{key: "starts", label: "starts", type: "datetime"}], views: [
      {id: "v", name: "Evening", viewType: "table", filters: [{field: "starts", op: "gte", value: "2026-11-25T18:00"}]},
    ],
  }})!;
  const view = db.views[0];
  const records = [{file: {path: "Evening.md"} as any, frontmatter: {starts: "2026/11/25 8:30 PM"}}];
  const matches = new RowPipeline().build(records, view, new ViewStateStore().get(0, 0, view)).map(r=>r.file.path);
  expect(matches).toEqual(["Evening.md"]);
});
