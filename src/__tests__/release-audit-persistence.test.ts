import { collectStatusOptionRenames, cloneStatusOptionDraft } from "../views/modals/StatusOptionsModal";
import { expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { setLocale } from "../i18n";
import { EmbeddedDataOperations } from "../views/EmbeddedDataOperations";
import { prepareReminderCompletionRename, type RecordReminderRule } from "../data/RecordReminders";
import type { ColumnDef, DatabaseConfig } from "../data/types";
import { DataSource } from "../data/DataSource";
import { applyNewDatabaseDefaults, normalizeNewViewDefaults } from "../data/NewViewDefaults";
import { createVaultStarter, instantiateVaultStarter } from "../data/VaultStarterTemplates";
import { executeRenameTransaction, reverseRenamePlan, type RenamePlan } from "../data/RenameTransaction";

setLocale("en");

vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, Modal: class {}, Notice: class {}, normalizePath: (path: string) => path }));

it("preserves the explicit true title from a saved chart through the custom template creation path", () => {
  const raw = {
    db_view: true,
    database: {
      id: "original", name: "Original", columns: [],
      views: [
        { id: "explicit", name: "Explicit", viewType: "chart", chartShowTitle: true },
        { id: "inherited", name: "Inherited", viewType: "chart" },
      ],
    },
  };
  const ds = new DataSource({} as App);
  const db = ds.parseDatabaseConfig(raw)!;
  const template = createVaultStarter(db, "Starter", "", []);
  const created = instantiateVaultStarter(template, "New", "Notes");
  applyNewDatabaseDefaults(created, normalizeNewViewDefaults({ views: { chart: { chartShowTitle: false } } }));
  expect(created.views.map(view => view.chartShowTitle)).toEqual([true, false]);
});

it("rolls files back if dependent reminder settings cannot be written, and reverses the field direction on undo", async () => {
  const plan: RenamePlan = {
    frontmatter: [], externalConfigs: [], undoLabel: "Rename",
    primaryConfig: { path: "DB.md", before: "due", after: "deadline", casBefore: "due", casAfter: "deadline" },
    columnKeyRename: { databaseId: "db", oldKey: "due", newKey: "deadline" },
  };
  const patch = vi.fn(async () => {});
  const refs = vi.fn(async () => {});
  refs.mockRejectedValueOnce(new Error("plugin settings conflict"));
  const writer = { patchFrontmatter: vi.fn(async () => {}), patchConfig: patch, patchColumnKeyReferences: refs };
  const failed = await executeRenameTransaction(plan, writer);
  expect(failed).toMatchObject({ ok: false, failedStep: { kind: "references", path: "DB.md" } });
  expect(patch.mock.calls).toEqual([["DB.md", "due", "deadline", "deadline", undefined], ["DB.md", "deadline", "due", "due", undefined]]);
  const undo = reverseRenamePlan(plan);
  expect(await executeRenameTransaction(undo, writer)).toMatchObject({ ok: true });
  expect(refs).toHaveBeenLastCalledWith({ databaseId: "db", oldKey: "deadline", newKey: "due" });
});

it("retains the distinction between absent and explicitly disabled switches over reload and template creation", () => {
  const ds = new DataSource({} as App);
  const defaults = normalizeNewViewDefaults({
    database: { quickFormEnabled: true }, shared: { showRecordIcon: true },
    views: { list: { listCompactFields: true }, chart: { chartShowDataLabels: true } },
  });
  for (const value of [undefined, false] as const) {
    const raw = { db_view: true, database: {
      id: "old", name: "Old", quickFormEnabled: value, columns: [],
      views: [
        { id: "l", name: "List", viewType: "list", showRecordIcon: value, listCompactFields: value },
        { id: "c", name: "Chart", viewType: "chart", chartShowDataLabels: value },
      ],
    } };
    const loaded = ds.parseDatabaseConfig(raw)!;
    const saved = ds.serializeDatabaseConfig(loaded);
    const reloaded = ds.parseDatabaseConfig({ db_view: true, database: saved })!;
    const created = instantiateVaultStarter(createVaultStarter(reloaded, "Starter", "", []), "New", "Notes");
    applyNewDatabaseDefaults(created, defaults);
    expect([created.quickFormEnabled, created.views[0].showRecordIcon, created.views[0].listCompactFields, created.views[1].chartShowDataLabels])
      .toEqual(Array(4).fill(value ?? true));
  }
});

it("tracks the original option through a rename and reorder without inferring from position", () => {
  const selected = { value: "Finished", color: "green", originalValue: "Done" } as const;
  const baseline = { value: "Todo", color: "gray", originalValue: "Todo" } as const;
  const fresh = { value: "New", color: "gray" } as const;
  expect(collectStatusOptionRenames(cloneStatusOptionDraft([selected, fresh, baseline]))).toEqual([{ from: "Done", to: "Finished" }]);
});

it("renames reminder completion values and original note values in one embedded edit and undo", async () => {
  const field: ColumnDef = { key: "state", label: "State", type: "status", statusOptions: [{ value: "Done", color: "green" }] };
  const schema = { columns: [field], computedFields: [] };
  let database: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "Notes", schema,
    views: [{ id: "view", name: "View", sourceFolder: "", schema }] };
  const dbFile = Object.assign(new TFile(), { path: "DB.md" });
  const taskFile = Object.assign(new TFile(), { path: "Notes/task.md" });
  const task = { state: "Done" };
  let rules: RecordReminderRule[] = [{ id: "r", databaseId: "db", enabled: true, dateField: "date", completionField: "state",
    completedValues: ["Done"], dateOnlyTime: "09:00", advanceMinutes: 0 }];
  const app = { vault: { getAbstractFileByPath: (path: string) => path === dbFile.path ? dbFile : taskFile } } as unknown as App;
  const data = {
    getRecordsForDatabase: () => [{ file: taskFile, frontmatter: task }],
    readViewDefSnapshot: async () => ({ typedConfig: structuredClone(database), rawPayload: database }),
    serializeDatabaseConfig: (value: DatabaseConfig) => value,
    readFrontmatterKeySnapshots: async () => ({ state: { exists: true, value: task.state } }),
    patchFrontmatter: async (_p: string, _expected: unknown, put: { state: { value: string } }, guard: () => void) => {
      guard(); task.state = put.state.value;
    },
    patchViewDefConfig: async (_p: string, _expected: unknown, _patch: unknown, next: DatabaseConfig, _mutation: unknown, guard: () => void) => {
      guard(); database = next;
    },
  } as unknown as DataSource;
  const op = new EmbeddedDataOperations(app, data, "fixture", () => ({ path: dbFile.path, dbId: "db", viewId: "view" }),
    () => true, () => {}, async () => {}, () => {}, async (dbId, change, reverse) => {
      const update = prepareReminderCompletionRename(rules, dbId, change, reverse);
      rules = update.rules;
      change.history = update.history;
    });
  expect(await op.editField([taskFile.path], field, undefined, { previousOptions: field.statusOptions,
    nextOptions: [{ value: "Closed", color: "green" }], renameValues: [{ from: "Done", to: "Closed" }], setValue: false })).toBe(true);
  expect([rules[0].completedValues[0], task.state, database.schema.columns[0].statusOptions?.[0].value]).toEqual(["Closed", "Closed", "Closed"]);
  await op.replay("undo");
  expect([rules[0].completedValues[0], task.state, database.schema.columns[0].statusOptions?.[0].value]).toEqual(["Done", "Done", "Done"]);
});

it("does not turn built-in layout fallbacks into explicit custom template choices", () => {
  const ds = new DataSource({} as App);
  const db = ds.parseDatabaseConfig({ db_view: true, database: { id: "db", name: "DB", columns: [],
    views: [{ name: "Omitted", viewType: "gallery" }, { name: "Explicit", viewType: "gallery", galleryCardSize: 250, galleryImageFit: "cover" }] } })!;
  const parsed = ds.parseDatabaseConfig({ db_view: true, database: ds.serializeDatabaseConfig(db) })!;
  const result = instantiateVaultStarter(createVaultStarter(parsed, "Starter", "", []), "New", "Notes");
  applyNewDatabaseDefaults(result, normalizeNewViewDefaults({ views: { gallery: { galleryCardSize: 340, galleryImageFit: "contain" } } }));
  expect(result.views.map(v => [v.galleryCardSize, v.galleryImageFit])).toEqual([[340, "contain"], [250, "cover"]]);
});
