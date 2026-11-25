import { expect, it, vi } from "vitest";
import Plugin from "../main";
import { DataSource } from "../data/DataSource";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
import { createDatabaseFromModalResult } from "../views/modals/AddDatabaseFlow";
import { parseVaultStarter } from "../data/VaultStarterTemplates";
import { setLocale } from "../i18n";
import type { DatabaseConfig, RowData } from "../data/types";
vi.mock("obsidian", () => ({
  Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {},
  FileView: class {}, MarkdownRenderChild: class {}, Component: class {}, Scope: class {},
  Modal: class {}, MarkdownView: class {}, TFile: class {}, TFolder: class {},
  Platform: { isMobile: false }, normalizePath(path: string) { return path; },
  Notice: class {}, stringifyYaml: (value: unknown) => JSON.stringify(value),
}));
async function run(kind: "csv" | "starter"): Promise<void> {
  setLocale("en");
  const fs = new Map();
  const app = { vault: {
    getFiles: () => [],
    getAbstractFileByPath: (path: string) => fs.get(path),
    createFolder: async (path: string) => { fs.set(path, {}); },
    create: async (path: string, text: string) => { fs.set(path, text); return {path}; },
    read: async (file: {path: string}) => fs.get(file.path),
  } };
  const ds = new DataSource(app as any);
  const createViewDefFile = ds.createViewDefFile.bind(ds);
  let note = "";
  const dataSource = Object.assign(ds, {
    getViewDefFiles: () => [],
    openNote: () => {},
    createViewDefFile: async (folder: string, name: string, config: DatabaseConfig) => {
      const file = await createViewDefFile(folder, name, config);
      note = file.path;
      return file;
    },
  });
  const plugin = Object.assign(Object.create(Plugin.prototype), {
    settings: { databaseFolder: "Definitions" }, app, dataSource,
    confirmNewDatabasePropertyTypeConflicts: async () => true, saveSettings: async () => {},
  });
  const schema = { columns: [{ key: "file.name", label: "Name", type: "text" }, { key: "amount", label: "amount", type: "text" }], computedFields: [] };
  const database = { id: "old", name: "Old database", sourceFolder: "", schema, views: [
    { id: "table", name: "Table", viewType: "table", sourceFolder: "", schema, filters: [{ field: "amount", op: "eq", value: "01" }] },
  ] };
  if (kind === "starter") {
    const oldStarter = { kind: "note-database-starter", version: 1, id: "old-template", name: "Template", description: "",
      config: database, samples: [{ filename: "Example", body: "", frontmatter: { amount: "1" } }] };
    await createDatabaseFromModalResult(app as any, dataSource, { name: "Created", sourceFolder: "Records", customStarter: parseVaultStarter(JSON.stringify(oldStarter)) }, "Created", "Definitions", async () => ({commit: async () => {}}));
  } else await plugin.importFromCsvs({
    csvFiles: [{ name: "Table.csv", text: async () => "Name,amount\nExample,1\n" }],
    markdownFiles: [], databaseName: "Restored", targetFolder: "Records",
  }, { format: "note-database-csv-markdown", version: 3, database });
  const persisted = JSON.parse(fs.get(note).split("\n")[1]);
  const rowPath = "Records/Example.md";
  const records = [{ file: { path: rowPath, name: "Example.md", basename: "Example" } as RowData["file"], frontmatter: JSON.parse(fs.get(rowPath).split("\n")[1]) }];
  const restored = ds.parseDatabaseConfig(persisted)!;
  const view = restored.views[0];
  const result = new RowPipeline().build(records, view, new ViewStateStore().get(0, 0, view)).map(row => row.file.path);
  expect(result).toEqual([rowPath]);
}
it("preserves legacy numeric-fallback equality when recovering a CSV+Markdown database", () => run("csv"));
it("preserves legacy numeric-fallback equality when creating a database from a saved starter template", () => run("starter"));
