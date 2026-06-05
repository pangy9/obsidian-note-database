import { beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnOperations } from "../views/ColumnOperations";
import { ColumnDef, DatabaseConfig, ViewConfig } from "../data/types";

// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
const _g = globalThis as unknown as Record<string, unknown>;

vi.mock("obsidian", () => ({
  Modal: class Modal {
    app: unknown;
    contentEl = { empty: vi.fn(), addClass: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
    modalEl = { isShown: vi.fn().mockReturnValue(false) };
    constructor(app: unknown) {
      this.app = app;
    }
    open(): void {}
    close(): void {}
  },
  Notice: class Notice {
    constructor(_message?: string) {}
  },
  TFile: class TFile {},
}));

vi.mock("../views/modals/ConfirmModal", () => ({
  confirmWithModal: vi.fn().mockResolvedValue(true),
}));

_g.document = { documentElement: { lang: "en" } };
// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US" },
});

function makeState() {
  return {
    hiddenColumns: new Set<string>(),
    filters: [],
    sortRules: [],
    sortDirection: "asc" as const,
    groupByField: "",
  };
}

interface PropertyServiceMock {
  renameKey: ReturnType<typeof vi.fn>;
  deleteKey: ReturnType<typeof vi.fn>;
  ensureKey: ReturnType<typeof vi.fn>;
  copyKey: ReturnType<typeof vi.fn>;
  convertKeyType: ReturnType<typeof vi.fn>;
  getDefaultValue: ReturnType<typeof vi.fn>;
  setObsidianPropertyType: ReturnType<typeof vi.fn>;
}

interface OpsDeps {
  app: unknown;
  dataSource: { getRecordsForConfig: ReturnType<typeof vi.fn> };
  propertyService: PropertyServiceMock;
  viewStateStore: { persist: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  getConfig: () => ViewConfig;
  getActiveDb: () => DatabaseConfig;
  getState: () => ReturnType<typeof makeState>;
  getFilesForConfig: () => unknown[];
  saveConfigImmediately: ReturnType<typeof vi.fn>;
  saveCurrentViewConfig: ReturnType<typeof vi.fn>;
  scheduleConfigSave: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  refreshSchemaChanged: ReturnType<typeof vi.fn>;
  refreshAfterSave: ReturnType<typeof vi.fn>;
  markPendingColumn: ReturnType<typeof vi.fn>;
  refreshColumnManager: ReturnType<typeof vi.fn>;
  setPendingUndoLabel: ReturnType<typeof vi.fn>;
  setPendingConfigCellChanges: ReturnType<typeof vi.fn>;
  getDefaultStatusOptions: ReturnType<typeof vi.fn>;
}

function makeOps(db: DatabaseConfig, view: ViewConfig) {
  const state = makeState();
  const propertyService: PropertyServiceMock = {
    renameKey: vi.fn().mockResolvedValue({ moved: 0, skippedConflicts: 0, deletedStale: 0 }),
    deleteKey: vi.fn().mockResolvedValue({ changed: 0, skipped: 0 }),
    ensureKey: vi.fn().mockResolvedValue({ changed: 0, skipped: 0 }),
    copyKey: vi.fn().mockResolvedValue({ changed: 0, skipped: 0 }),
    convertKeyType: vi.fn().mockResolvedValue({ changed: 0, skipped: 0 }),
    getDefaultValue: vi.fn().mockReturnValue(""),
    setObsidianPropertyType: vi.fn().mockResolvedValue(undefined),
  };
  const deps: OpsDeps = {
    app: {},
    dataSource: { getRecordsForConfig: vi.fn().mockReturnValue([]) },
    propertyService,
    viewStateStore: { persist: vi.fn(), clear: vi.fn() },
    getConfig: () => view,
    getActiveDb: () => db,
    getState: () => state,
    getFilesForConfig: () => [],
    saveConfigImmediately: vi.fn().mockResolvedValue(undefined),
    saveCurrentViewConfig: vi.fn().mockResolvedValue(undefined),
    scheduleConfigSave: vi.fn(),
    refresh: vi.fn(),
    refreshSchemaChanged: vi.fn(),
    refreshAfterSave: vi.fn().mockResolvedValue(undefined),
    markPendingColumn: vi.fn(),
    refreshColumnManager: vi.fn(),
    setPendingUndoLabel: vi.fn(),
    setPendingConfigCellChanges: vi.fn(),
    getDefaultStatusOptions: vi.fn().mockReturnValue([]),
  };
  const ops = new ColumnOperations(deps as unknown as ConstructorParameters<typeof ColumnOperations>[0]);
  return { ops, propertyService, state };
}

describe("ColumnOperations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _g.window = {
      activeDocument: { documentElement: { lang: "en" } },
      confirm: vi.fn().mockReturnValue(true),
    };
  });

  it("keeps schema and view references consistent when a new column is renamed then deleted", async () => {
    const columns: ColumnDef[] = [
      { key: "file.name", label: "Name", type: "text" },
      { key: "new_field", label: "New field", type: "text" },
    ];
    const schema = { columns, computedFields: [] };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "new_field"],
      hiddenColumns: [],
    };
    const secondView: ViewConfig = {
      id: "board",
      name: "Board",
      sourceFolder: "",
      schema: JSON.parse(JSON.stringify(schema)) as ViewConfig["schema"],
      columnOrder: ["new_field", "file.name"],
      hiddenColumns: ["new_field"],
    };
    const db: DatabaseConfig = {
      id: "db",
      name: "DB",
      sourceFolder: "",
      schema,
      views: [view, secondView],
    };
    const { ops } = makeOps(db, view);
    const col = schema.columns[1];

    await ops.renameColumn(col, { key: "renew_day", label: "Renew day", migrateValues: true, wrap: false });
    expect(db.schema.columns.map((candidate) => candidate.key)).toEqual(["file.name", "renew_day"]);
    expect(db.views.every((candidate) => candidate.schema === db.schema)).toBe(true);
    expect(view.columnOrder).toEqual(["file.name", "renew_day"]);
    expect(secondView.columnOrder).toEqual(["renew_day", "file.name"]);

    await ops.deleteColumn(db.schema.columns[1]);
    expect(db.schema.columns.map((candidate) => candidate.key)).toEqual(["file.name"]);
    expect(view.columnOrder).toEqual(["file.name"]);
    expect(secondView.columnOrder).toEqual(["file.name"]);
    expect(secondView.hiddenColumns).toEqual([]);
  });

  it("uses computed storage keys instead of formula-prefixed column keys for saved properties", async () => {
    const computedCol: ColumnDef = { key: "formula.done", label: "Done", type: "computed", computedKey: "done" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, computedCol],
      computedFields: [{ key: "done", label: "Done", expression: "note.done", type: "checkbox" as const, expressionSyntax: "base" as const }],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "formula.done"],
    };
    const db: DatabaseConfig = {
      id: "db",
      name: "DB",
      sourceFolder: "",
      computedSyncMode: "automatic",
      schema,
      views: [view],
    };
    const { ops, propertyService } = makeOps(db, view);

    await ops.renameColumn(computedCol, { key: "review_done", label: "Review done", migrateValues: false, wrap: false });

    expect(propertyService.renameKey).toHaveBeenCalledWith([], "done", "review_done", undefined, true);
    expect(db.schema.columns[1]).toMatchObject({ key: "review_done", computedKey: "review_done" });
    expect(db.schema.computedFields[0]).toMatchObject({ key: "review_done", label: "Review done" });

    await ops.deleteColumn(db.schema.columns[1]);
    expect(propertyService.deleteKey).toHaveBeenCalledWith([], "review_done");
    expect(db.schema.columns.map((candidate) => candidate.key)).toEqual(["file.name"]);
    expect(db.schema.computedFields).toEqual([]);
  });
});
