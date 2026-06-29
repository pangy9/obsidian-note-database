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

  it("deletes readonly file fields from config without touching frontmatter", async () => {
    const filePathCol: ColumnDef = { key: "file.path", label: "Path", type: "text" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, filePathCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "file.path"],
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops, propertyService } = makeOps(db, view);

    await ops.deleteColumn(filePathCol);

    expect(db.schema.columns.map((candidate) => candidate.key)).toEqual(["file.name"]);
    expect(view.columnOrder).toEqual(["file.name"]);
    expect(propertyService.deleteKey).not.toHaveBeenCalled();
  });

  it("clears chartValueField when the numeric value column is deleted", async () => {
    const amountCol: ColumnDef = { key: "amount", label: "Amount", type: "number" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, { key: "status", label: "Status", type: "status" as const }, amountCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "chart",
      name: "Chart",
      viewType: "chart",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "status", "amount"],
      chartGroupField: "status",
      chartAggregation: "sum",
      chartValueField: "amount",
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops, propertyService } = makeOps(db, view);

    await ops.deleteColumn(amountCol);

    expect(view.chartGroupField).toBe("status");
    expect(view.chartValueField).toBeUndefined();
    expect(propertyService.deleteKey).toHaveBeenCalledWith([], "amount");
  });

  it("clears calendar and timeline field references when a column is deleted", async () => {
    const dateCol: ColumnDef = { key: "date", label: "Date", type: "date" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, dateCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "timeline",
      name: "Timeline",
      viewType: "timeline",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "date"],
      calendarStartDateField: "date",
      calendarEndDateField: "date",
      calendarTitleField: "date",
      timelineStartDateField: "date",
      timelineEndDateField: "date",
      timelineGroupField: "date",
      timelineTitleField: "date",
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops } = makeOps(db, view);

    await ops.deleteColumn(dateCol);

    expect(view.calendarStartDateField).toBeUndefined();
    expect(view.calendarEndDateField).toBeUndefined();
    expect(view.calendarTitleField).toBeUndefined();
    expect(view.timelineStartDateField).toBeUndefined();
    expect(view.timelineEndDateField).toBeUndefined();
    expect(view.timelineGroupField).toBeUndefined();
    expect(view.timelineTitleField).toBeUndefined();
  });

  it("clears chartValueField when the value column is converted to a non-numeric type", async () => {
    const amountCol: ColumnDef = { key: "amount", label: "Amount", type: "number" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, { key: "status", label: "Status", type: "status" as const }, amountCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "chart",
      name: "Chart",
      viewType: "chart",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "status", "amount"],
      chartGroupField: "status",
      chartAggregation: "sum",
      chartValueField: "amount",
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops } = makeOps(db, view);

    await ops.changeColumnType(amountCol, "text");

    expect(amountCol.type).toBe("text");
    expect(view.chartValueField).toBeUndefined();
  });

  it("clears calendar and timeline date references when a date column becomes non-date", async () => {
    const dateCol: ColumnDef = { key: "date", label: "Date", type: "date" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, dateCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "timeline",
      name: "Timeline",
      viewType: "timeline",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "date"],
      calendarStartDateField: "date",
      calendarEndDateField: "date",
      calendarTitleField: "date",
      timelineStartDateField: "date",
      timelineEndDateField: "date",
      timelineGroupField: "date",
      timelineTitleField: "date",
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops } = makeOps(db, view);

    await ops.changeColumnType(dateCol, "text");

    expect(view.calendarStartDateField).toBeUndefined();
    expect(view.calendarEndDateField).toBeUndefined();
    expect(view.timelineStartDateField).toBeUndefined();
    expect(view.timelineEndDateField).toBeUndefined();
    expect(view.calendarTitleField).toBe("date");
    expect(view.timelineGroupField).toBe("date");
    expect(view.timelineTitleField).toBe("date");
  });

  it("leaves timeline day scale when a configured datetime field is downgraded to date", async () => {
    const startCol: ColumnDef = { key: "start", label: "Start", type: "datetime" };
    const endCol: ColumnDef = { key: "end", label: "End", type: "datetime" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, startCol, endCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "timeline",
      name: "Timeline",
      viewType: "timeline",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "start", "end"],
      timelineStartDateField: "start",
      timelineEndDateField: "end",
      timelineScale: "day",
      timelineAnchorTimeMinutes: 8 * 60,
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops } = makeOps(db, view);

    await ops.changeColumnType(endCol, "date");

    expect(endCol.type).toBe("date");
    expect(view.timelineScale).toBe("week");
    expect(view.timelineAnchorTimeMinutes).toBeUndefined();
    expect(view.timelineStartDateField).toBe("start");
    expect(view.timelineEndDateField).toBe("end");
  });

  it("blocks type changes and duplication for file fields", async () => {
    const tagsCol: ColumnDef = { key: "file.tags", label: "Tags", type: "multi-select" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, tagsCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "file.tags"],
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops, propertyService } = makeOps(db, view);

    await ops.changeColumnType(tagsCol, "text");
    await ops.duplicateColumn(tagsCol);

    expect(tagsCol.type).toBe("multi-select");
    expect(schema.columns.map((candidate) => candidate.key)).toEqual(["file.name", "file.tags"]);
    expect(propertyService.copyKey).not.toHaveBeenCalled();
  });

  it("allows file fields to update display settings without frontmatter migration", async () => {
    const tagsCol: ColumnDef = { key: "file.tags", label: "Tags", type: "multi-select" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, tagsCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "file.tags"],
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops, propertyService } = makeOps(db, view);

    await ops.renameColumn(tagsCol, { key: "file.tags", label: "Note tags", migrateValues: true, wrap: true });

    expect(tagsCol).toMatchObject({ key: "file.tags", label: "Note tags", type: "multi-select", wrap: true });
    expect(propertyService.renameKey).not.toHaveBeenCalled();
    expect(propertyService.deleteKey).not.toHaveBeenCalled();
  });

  it("deletes old frontmatter when a normal property is converted to a supported file field", async () => {
    const customCol: ColumnDef = { key: "custom", label: "Custom", type: "text" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, customCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "custom"],
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops, propertyService } = makeOps(db, view);

    await ops.renameColumn(customCol, { key: "file.path", label: "Path", migrateValues: true, wrap: false });

    expect(customCol).toMatchObject({ key: "file.path", label: "Path", type: "text" });
    expect(propertyService.renameKey).not.toHaveBeenCalled();
    expect(propertyService.deleteKey).toHaveBeenCalledWith([], "custom");
  });

  it("does not create pending frontmatter values for file fields", () => {
    const backlinksCol: ColumnDef = { key: "file.backlinks", label: "Backlinks", type: "text" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, backlinksCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "file.backlinks"],
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops } = makeOps(db, view);
    const getEnsureKeyChanges = (ops as unknown as {
      getEnsureKeyChanges(config: ViewConfig, col: ColumnDef): unknown[];
    }).getEnsureKeyChanges.bind(ops);

    expect(getEnsureKeyChanges(view, backlinksCol)).toEqual([]);
  });

  it("preserves the database viewport after inserting or appending columns", async () => {
    const firstCol: ColumnDef = { key: "file.name", label: "Name", type: "text" };
    const secondCol: ColumnDef = { key: "status", label: "Status", type: "text" };
    const schema = {
      columns: [firstCol, secondCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "status"],
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops, propertyService } = makeOps(db, view);
    propertyService.ensureKey.mockResolvedValue({ changed: 0, skipped: 0 });

    await ops.insertColumnNear(secondCol, "left");
    await ops.appendColumn();

    expect((ops as unknown as { deps: OpsDeps }).deps.refreshSchemaChanged).toHaveBeenNthCalledWith(1, { preserveViewport: true });
    expect((ops as unknown as { deps: OpsDeps }).deps.refreshSchemaChanged).toHaveBeenNthCalledWith(2, { preserveViewport: true });
  });

  it("rejects unsupported file.* keys when renaming normal columns", async () => {
    const customCol: ColumnDef = { key: "custom", label: "Custom", type: "text" };
    const schema = {
      columns: [{ key: "file.name", label: "Name", type: "text" as const }, customCol],
      computedFields: [],
    };
    const view: ViewConfig = {
      id: "table",
      name: "Table",
      sourceFolder: "",
      schema,
      columnOrder: ["file.name", "custom"],
    };
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema, views: [view] };
    const { ops, propertyService } = makeOps(db, view);

    await ops.renameColumn(customCol, { key: "file.unknown", label: "Unknown", migrateValues: true, wrap: false });

    expect(customCol.key).toBe("custom");
    expect(propertyService.renameKey).not.toHaveBeenCalled();
    expect(propertyService.deleteKey).not.toHaveBeenCalled();
  });
});
