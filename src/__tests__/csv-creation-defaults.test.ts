import { expect, it, vi } from "vitest";
import Plugin from "../main";
import { setLocale } from "../i18n";
import { createDatabaseFromModalResult } from "../views/modals/AddDatabaseFlow";
import type { DatabaseConfig } from "../data/types";

vi.mock("obsidian", () => ({
  Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {},
  FileView: class {}, MarkdownRenderChild: class {}, Component: class {}, Scope: class {},
  Modal: class {}, MarkdownView: class {}, TFile: class {}, TFolder: class {},
  Platform: { isMobile: false }, normalizePath(path: string) { return path; },
  Notice: class {}, stringifyYaml: () => "n: 1",
}));
vi.mock("../data/FrontmatterScanner", () => ({
  collectFileFrontmatterKeys: () => {},
}));
vi.mock("../views/modals/BaseImportConfirmModal", () => ({
  BaseImportConfirmModal: class {
    constructor(_: unknown, private columns: unknown[]) {}
    async openAndWait() { return this.columns; }
  },
}));

it("routes the same New Database preferences through plain CSV import", async () => {
  setLocale("en");
  const defaults = {database: {quickFormEnabled: true}, shared: {}, views: {table: {defaultColumnWidth: 420}}};
  const created = new Map<string, DatabaseConfig>();
  const fs = new Map();
  const app = { vault: {
    getFiles: () => [],
    getAbstractFileByPath: (path: string) => fs.get(path),
    createFolder: async (path: string) => { fs.set(path, {}); },
    create: async (path: string, text: string) => { fs.set(path, text); return {path}; },
    read: async (file: {path: string}) => fs.get(file.path),
  } };
  const dataSource = {
    getViewDefFiles: () => [],
    openNote: () => {},
    createViewDefFile: async (_folder: string, name: string, config: DatabaseConfig) => {
      created.set(name, structuredClone(config));
      return app.vault.create(name + ".md", "db");
    },
  };
  const plugin = Object.assign(Object.create(Plugin.prototype), {
    settings: { databaseFolder: "Definitions", newViewDefaults: defaults }, app, dataSource,
    confirmNewDatabasePropertyTypeConflicts: async () => true, saveSettings: async () => {},
  });
  await (createDatabaseFromModalResult as any)(app, dataSource, {name: "Direct", sourceFolder: "Direct"}, "Direct", "Definitions", async () => ({commit: async () => {}}), defaults);
  await plugin.importFromCsvs({
    csvFiles: [{name: "Imported.csv", text: async () => "Name,n\nExample,1\n"}],
    markdownFiles: [], databaseName: "Imported", targetFolder: "Imported records",
  }, null);
  const read = (name: string) => {
    const config = created.get(name)!;
    return {quickFormEnabled: config.quickFormEnabled, defaultColumnWidth: config.views[0].defaultColumnWidth};
  };
  expect(read("Imported")).toEqual({ quickFormEnabled: true, defaultColumnWidth: 420 });
  expect(read("Imported")).toEqual(read("Direct"));
  const saved = structuredClone(created.get("Imported")!);
  saved.quickFormEnabled = false;
  saved.views[0].defaultColumnWidth = 160;
  await plugin.importFromCsvs({
    csvFiles: [{ name: "Restored.csv", text: async () => "Name,n\nExample,1\n" }],
    markdownFiles: [], databaseName: "Restored", targetFolder: "Restored records",
  }, { database: saved });
  expect(read("Restored")).toEqual({ quickFormEnabled: false, defaultColumnWidth: 160 });
});


it("keeps the standalone width when a stale or reset popover draft is saved", async () => {
  const saveData = vi.fn(async (_next: unknown) => {});
  const plugin = Object.assign(Object.create(Plugin.prototype), {
    settings: { newViewDefaults: { database: {}, shared: { displayWidth: "default" }, views: {} } },
    saveData, settingsWriteTail: Promise.resolve(),
  }) as Plugin;
  const stale = { database: { quickFormEnabled: true }, shared: { displayWidth: "default" as const }, views: {} };
  await Promise.all([plugin.saveNewViewDisplayWidth("wide"), plugin.saveNewViewDefaults(stale)]);
  expect(saveData.mock.calls.at(-1)?.[0]).toMatchObject({
    newViewDefaults: { database: { quickFormEnabled: true }, shared: { displayWidth: "wide" }, views: {} },
  });
  await plugin.saveNewViewDefaults({ database: {}, shared: {}, views: {} });
  expect(plugin.settings.newViewDefaults?.shared).toEqual({ displayWidth: "wide" });

  saveData.mockRejectedValueOnce(new Error("disk error"));
  await expect(plugin.saveNewViewDisplayWidth("default")).rejects.toThrow("disk error");
  expect(plugin.settings.newViewDefaults?.shared).toEqual({ displayWidth: "wide" });
  await plugin.saveNewViewDisplayWidth("default");
  expect(plugin.settings.newViewDefaults?.shared).toEqual({ displayWidth: "default" });
});

it("uses the standalone display width when converting a .base file without changing its columns", async () => {
  const schema: DatabaseConfig["schema"] = { columns: [{ key: "file.name", label: "Name", type: "text" }], computedFields: [] };
  const converted: DatabaseConfig = { id: "base", name: "Source", sourceFolder: "", schema, views: [
    { name: "Table", viewType: "table", sourceFolder: "", schema, columnWidths: { "file.name": 320 } },
    { name: "List", viewType: "list", sourceFolder: "", schema },
  ] };
  const create = vi.fn(async (_folder: string, _name: string, db: DatabaseConfig) => ({ path: "New.md", db }));
  const plugin = Object.assign(Object.create(Plugin.prototype), {
    settings: { databaseFolder: "Definitions", newViewDefaults: {
      database: {}, shared: { displayWidth: "wide" }, views: { table: { defaultColumnWidth: 200 } },
    } },
    app: { vault: { read: vi.fn(async () => "views: []") } },
    dataSource: { getViewDefFiles: () => [], getRecordsForDatabase: () => [], createViewDefFile: create, openNote: vi.fn() },
    createConfigFromBase: () => ({ config: converted, inferredColumns: [], mapViewDowngraded: false }),
    confirmNewDatabasePropertyTypeConflicts: vi.fn(async () => true),
  }) as { convertBaseToDatabase(file: { basename: string; path: string }): Promise<void> };
  await plugin.convertBaseToDatabase({ basename: "Source", path: "Source.base" });
  const saved = create.mock.calls[0][2];
  expect(saved.views.map(view => view.displayWidth)).toEqual(["wide", "wide"]);
  expect(saved.views[0].columnWidths).toEqual({ "file.name": 320 });
  expect(saved.views[0].defaultColumnWidth).toBeUndefined();
});
