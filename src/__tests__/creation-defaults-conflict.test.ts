import { it, expect, vi } from "vitest";
import type { App } from "obsidian";
import type { DataSource } from "../data/DataSource";
import type { ColumnDef, DatabaseConfig } from "../data/types";
import { normalizeNewViewDefaults } from "../data/NewViewDefaults";
import { createVaultStarter } from "../data/VaultStarterTemplates";
import { createDatabaseFromModalResult } from "../views/modals/AddDatabaseFlow";
import { prepareNewDatabasePropertyTypeConflictsForCreate } from "../views/PropertyTypeConflictWorkflow";

vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, Notice: class {}, normalizePath: (s: string) => s }));
vi.mock("../i18n", () => ({ t: (key: string) => key }));
vi.mock("../data/FrontmatterScanner", () => ({}));
vi.mock("../views/modals/BaseImportConfirmModal", () => ({}));
vi.mock("../views/modals/PropertyTypeConflictModal", () => ({ PropertyTypeConflictModal: class {
  constructor(_app: App, readonly options: { conflicts: [{ writers: [{ databaseId: string; databaseName: string }] }] }) {}
  openAndWait() {
    const newWriter = this.options.conflicts[0].writers.find(w => w.databaseName === "New")!;
    return {action: "resolve", changes: [{ databaseId: newWriter.databaseId, key: "due", sourceKind: "column", type: "datetime" }]};
  }
} }));

function fixture(id: string, type: ColumnDef["type"]): DatabaseConfig {
  const schema = { columns: [{key: "due", label: "Due", type}], computedFields: [] };
  return { id, name: id, sourceFolder: "", schema, views: [{name: "Timeline", sourceFolder: "", viewType: "timeline", schema, timelineStartDateField: "due" }] };
}
it("applies a Day creation default to the final resolved Date & Time property of a custom template", async () => {
  const app = { vault: { getFiles: () => [], read: async () => "" } } as unknown as App;
  const prior = fixture("Existing", "datetime");
  let final: DatabaseConfig | undefined;
  const ds = { createViewDefFile: async (_folder: string, _name: string, config: DatabaseConfig) => { final = config; return {path: "New.md"}; } } as unknown as DataSource;
  const prepare = (db: DatabaseConfig) => prepareNewDatabasePropertyTypeConflictsForCreate(app, ds, [{ config: prior }], { config: db }, "test");
  const result = { name: "New", sourceFolder: "New", includeStarterSamples: false, customStarter: createVaultStarter(fixture("Template", "date"), "Template", "") };
  const preferences = normalizeNewViewDefaults({ views: { timeline: { timelineScale: "day" } } });
  const created = await createDatabaseFromModalResult(app, ds, result, "New", "DBs", prepare, preferences);
  expect(created?.path).toBe("New.md");
  expect(final?.schema.columns[0].type).toBe("datetime");
  expect(final?.views[0].timelineScale).toBe("day");
});
