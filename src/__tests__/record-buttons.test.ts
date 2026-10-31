import { setLocale } from "../i18n";
import { describe, expect, it, vi } from "vitest";
import { findRecordButtonConfigurationIssue, planRecordButton, validateRecordButton, isButtonTarget, updateRecordButtonStyle, updateRecordButtonIcon } from "../data/RecordButton";
import { prepareRecordButton } from "../data/RecordButtonExecution";
import { applyFrontmatterWrites, verifyFrontmatterExpect } from "../data/FrontmatterPatch";
import { withRecordButtonLock } from "../views/RecordButtonRenderer";
import { updateColumnKeyReferences } from "../data/ColumnKeyReferences";
import { planCreateEntry } from "../data/CreateEntryPlan";
import { isFormWritableColumn } from "../data/FormModel";
import { canFillColumn } from "../data/CellValueNormalize";
import { createVaultStarter, parseVaultStarter, instantiateVaultStarter } from "../data/VaultStarterTemplates";
import type { ColumnDef, DatabaseConfig, RecordButtonAction, RecordButtonConfig, RecordButtonStep, ViewConfig } from "../data/types";

setLocale("en");
vi.mock("obsidian", () => ({ Notice: class {}, TFile: class {}, TFolder: class {}, setIcon: vi.fn(), setTooltip: vi.fn(), normalizePath: (p: string) => p }));
const columns: ColumnDef[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "count", label: "Count", type: "number" },
  { key: "price", label: "Price", type: "currency" },
  { key: "done", label: "Done", type: "checkbox" },
  { key: "date", label: "Date", type: "date" },
  { key: "time", label: "Time", type: "datetime" },
  { key: "status", label: "Status", type: "status", statusOptions: [{ value: "Todo", color: "gray" }, { value: "Done", color: "green" }] },
  { key: "labels", label: "Labels", type: "multi-select", statusOptions: [{ value: "A", color: "blue" }, { value: "B", color: "green" }] },
];
const action = (field: string, operation: RecordButtonAction["operation"], value?: RecordButtonAction["value"]): RecordButtonAction => ({ field, fieldType: columns.find((c) => c.key === field)!.type, operation, value });
const button = (...actions: RecordButtonAction[]): RecordButtonConfig => ({ label: "Finish", actions });
const buttonColumn: ColumnDef = { key: "finish", label: "Action", type: "button", buttonConfig: button(action("status", "set", "Done"), action("count", "increment", 1)) };

describe("button configuration error locations", () => {
  it("locates a step-level error without changing the draft", () => {
    const step: RecordButtonStep = { kind: "variable", name: "bad name", value: { source: "literal", value: "" } };
    const draft: RecordButtonConfig = { label: "Run", actions: [], steps: [step] };
    const before = JSON.stringify(draft);
    const issue = findRecordButtonConfigurationIssue(draft, columns, () => columns);
    expect(issue?.step).toBe(step); expect(issue?.action).toBeUndefined(); expect(issue?.message).toBeTruthy();
    expect(JSON.stringify(draft)).toBe(before);
  });
  it("locates the exact invalid child in a created record's schema", () => {
    const nested = action("count", "set", "invalid");
    const create: RecordButtonStep = { kind: "create", databaseId: "tasks", title: "Task", actions: [] };
    const edit: RecordButtonStep = { kind: "edit", target: "created", actions: [action("status", "set", "Todo"), nested] };
    const draft: RecordButtonConfig = { label: "Run", actions: [], steps: [create, edit] };
    const schemaFor = vi.fn((step: RecordButtonStep, created: ColumnDef[]) => step.kind === "create" ? columns : created);
    const issue = findRecordButtonConfigurationIssue(draft, [], schemaFor);
    expect(issue?.step).toBe(edit); expect(issue?.action).toBe(nested);
    expect(schemaFor).toHaveBeenLastCalledWith(edit, columns);
    nested.value = 2; expect(findRecordButtonConfigurationIssue(draft, [], schemaFor)).toBeUndefined();
  });
  it("keeps general configuration errors outside action cards", () => {
    const draft: RecordButtonConfig = { label: "", actions: [], steps: [{ kind: "confirm", message: "Continue?" }] };
    const issue = findRecordButtonConfigurationIssue(draft, columns, () => columns);
    expect(issue?.message).toBeTruthy(); expect(issue?.step).toBeUndefined();
  });
});

describe("record button execution", () => {
  it("runs ordered actions against one draft without mutating the input", () => {
    const original = { count: 5, status: "Todo", labels: ["A"], done: false, untouched: "keep" };
    const result = planRecordButton(button(
      action("count", "set", 2), action("count", "increment", 3), action("count", "increment", -1),
      action("status", "set", "Done"), action("done", "toggle"),
      action("labels", "add", ["A", "B"]), action("labels", "remove", ["A"]), action("title", "clear"),
    ), columns, original);
    expect(result).toEqual({ count: 4, status: "Done", done: true, labels: ["B"], title: null });
    expect(original).toEqual({ count: 5, status: "Todo", labels: ["A"], done: false, untouched: "keep" });
  });
  it("uses one local timestamp for all now actions", () => {
    expect(planRecordButton(button(action("date", "now"), action("time", "now")), columns, {}, new Date(2026, 9, 30, 14, 5, 9)))
      .toEqual({ date: "2026-10-30", time: "2026-10-30T14:05:09" });
  });
  it("supports setting all writable scalar types and clearing before increment", () => {
    expect(planRecordButton(button(action("title", "set", ""), action("price", "set", 1.25), action("done", "set", false), action("date", "set", "2024-02-29"), action("time", "set", "2026-10-30T13:15"), action("count", "clear"), action("count", "increment", 2)), columns, { count: 99 }))
      .toEqual({ title: "", price: 1.25, done: false, date: "2024-02-29", time: "2026-10-30T13:15", count: 2 });
  });
  it.each(["2026-02-30", "2026-13-01", "tomorrow"])("rejects invalid date %s", (value) => {
    expect(() => planRecordButton(button(action("date", "set", value)), columns, {})).toThrow();
  });
  it.each(["2026-10-30T24:00", "2026-10-30T12:99", "2026-10-30T12:20:60"])("rejects invalid time %s", (value) => {
    expect(() => planRecordButton(button(action("time", "set", value)), columns, {})).toThrow();
  });
  it("validates every action before producing a patch", () => {
    const original = { count: 4 };
    expect(() => planRecordButton(button(action("count", "increment", 1), action("status", "set", "Removed")), columns, original)).toThrow();
    expect(original).toEqual({ count: 4 });
    expect(() => validateRecordButton(button({ ...action("count", "increment", 1), fieldType: "text" }), columns)).toThrow();
    expect(() => validateRecordButton(button(action("count", "toggle")), columns)).toThrow();
    expect(() => validateRecordButton(button(action("labels", "add", ["Missing"])), columns)).toThrow();
    expect(() => validateRecordButton(button(action("title", "set", true)), columns)).toThrow();
  });
  it.each([NaN, Infinity, "abc", [], {}])("rejects malformed numeric state %s", (count) => {
    expect(() => planRecordButton(button(action("count", "increment", 1)), columns, { count })).toThrow();
  });
  it("handles missing numeric state and numeric YAML strings", () => {
    expect(planRecordButton(button(action("count", "increment", 1)), columns, {}).count).toBe(1);
    expect(planRecordButton(button(action("count", "increment", 1)), columns, { count: "4" }).count).toBe(5);
  });
  it("rejects read-only, derived and reserved targets", () => {
    for (const col of [buttonColumn, { key: "file.name", type: "text" }, { key: "calc", type: "computed" }, { key: "__proto__", type: "text" }] as ColumnDef[]) {
      expect(isButtonTarget(col)).toBe(false);
      expect(() => validateRecordButton(button({ field: col.key, fieldType: col.type, operation: "clear" }), [col])).toThrow();
    }
  });
  it("reads current snapshots once and commits a reversible patch preserving unrelated keys", async () => {
    const read = vi.fn(async () => ({ count: { exists: true, value: 9 }, status: { exists: false } }));
    const prepared = await prepareRecordButton({ readFrontmatterKeySnapshots: read }, "record.md", buttonColumn.buttonConfig!, columns);
    expect(read).toHaveBeenCalledExactlyOnceWith("record.md", ["status", "count"]);
    const fm: Record<string, unknown> = { count: 9, unrelated: "keep" };
    expect(verifyFrontmatterExpect(fm, prepared.before)).toEqual({ ok: true });
    applyFrontmatterWrites(fm, prepared.writes);
    expect(fm).toEqual({ count: 10, status: "Done", unrelated: "keep" });
    expect(verifyFrontmatterExpect(fm, prepared.after)).toEqual({ ok: true });
    applyFrontmatterWrites(fm, Object.fromEntries(Object.entries(prepared.before).map(([key, snap]) => [key, snap.exists ? { kind: "set", value: snap.value } : { kind: "delete" }])));
    expect(fm).toEqual({ count: 9, unrelated: "keep" });
    const changed = { count: 11, unrelated: "keep" };
    expect(verifyFrontmatterExpect(changed, prepared.before).ok).toBe(false);
    expect(changed.count).toBe(11);
  });
  it("does not read or write when configuration is invalid; elides unchanged writes", async () => {
    const read = vi.fn(async () => ({ done: { exists: true, value: true } }));
    await expect(prepareRecordButton({ readFrontmatterKeySnapshots: read }, "r.md", button(), columns)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    const result = await prepareRecordButton({ readFrontmatterKeySnapshots: read }, "r.md", button(action("done", "set", true)), columns);
    expect(result.writes).toEqual({});
  });
  it("blocks concurrent clicks on the same record and releases the lock on failure", async () => {
    const owner = {};
    let resolve!: () => void;
    const first = withRecordButtonLock(owner, "r.md", () => new Promise<void>((r) => { resolve = r; }));
    const second = vi.fn(async () => {});
    await withRecordButtonLock(owner, "r.md", second);
    expect(second).not.toHaveBeenCalled();
    await withRecordButtonLock(owner, "other.md", second);
    resolve(); await first;
    await expect(withRecordButtonLock(owner, "r.md", async () => { throw new Error("fail"); })).rejects.toThrow();
    await withRecordButtonLock(owner, "r.md", second);
    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe("virtual button properties", () => {
  const schema = () => ({ columns: structuredClone([...columns, buttonColumn]), computedFields: [] });
  it("follows a target property rename", () => {
    const config: ViewConfig = { id: "v", name: "View", sourceFolder: "Notes", schema: schema() };
    updateColumnKeyReferences(config, undefined, "count", "visits", { updateSourceRuleTree: () => false });
    expect(config.schema.columns.at(-1)!.buttonConfig!.actions[1].field).toBe("visits");
  });
  it("cannot be filled or used as a form input, and is stripped from new record defaults", () => {
    expect(isFormWritableColumn(buttonColumn)).toBe(false);
    expect(canFillColumn(buttonColumn)).toBe(false);
    const plan = planCreateEntry({ sourceRuleTree: undefined, schema: schema(), sourceFolder: "Notes", fallbackFolder: "", contextFrontmatter: { finish: "stale", count: 2 }, intentionalContextKeys: new Set(), defaultFilename: "Record", normalizeFolder: (x) => x });
    expect(plan.frontmatter).toEqual({ count: 2 });
  });
  it("retains button configuration through template export/import without sample values", () => {
    const db: DatabaseConfig = { id: "db", name: "Buttons", sourceFolder: "Notes", schema: schema(), views: [{ id: "v", name: "Table", sourceFolder: "Notes", viewType: "table", schema: schema() }] };
    const template = parseVaultStarter(JSON.stringify(createVaultStarter(db, "Buttons", "", [{ filename: "Record", body: "", frontmatter: { count: 2, finish: "stale" } }])));
    expect(template.samples[0].frontmatter).toEqual({ count: 2 });
    const copy = instantiateVaultStarter(template, "Copy", "Other", () => "new-id");
    expect(copy.schema.columns.at(-1)!.buttonConfig).toEqual(buttonColumn.buttonConfig);
  });
});

describe("button date snapshot comparisons", () => {
  it("detects a changed YAML date instead of comparing two empty Date objects", () => {
    expect(verifyFrontmatterExpect({ date: new Date("2026-10-31") }, { date: { exists: true, value: new Date("2026-10-30") } }).ok).toBe(false);
    expect(verifyFrontmatterExpect({ date: new Date("2026-10-30") }, { date: { exists: true, value: new Date("2026-10-30") } }).ok).toBe(true);
  });
});

describe("button property synchronization", () => {
  it("never delegates button rename, ensure, copy, convert or deletion to frontmatter writers", async () => {
    const { ColumnPropertySync } = await import("../views/ColumnPropertySync");
    const writer = new Proxy({}, { get: () => { throw new Error("Virtual property reached frontmatter writer"); } });
    const sync = new ColumnPropertySync(writer as ConstructorParameters<typeof ColumnPropertySync>[0], () => []);
    const config: ViewConfig = { name: "Test", sourceFolder: "", schema: { columns: [buttonColumn], computedFields: [] } };
    expect(sync.rename(config, buttonColumn, "finish", "renamed")).toBeNull();
    for (const op of [sync.ensure(config, buttonColumn), sync.copy(config, "finish", "copy"), sync.convert(config, buttonColumn, "text"), sync.delete(config, buttonColumn)]) {
      expect(await op).toEqual({ changed: 0, skipped: 0 });
    }
  });
});


describe("button style changes preserve workflow configuration", () => {
  it("changes only appearance and preserves action identity", () => {
    const config: RecordButtonConfig = { ...buttonColumn.buttonConfig!, icon: "check", confirm: true, steps: [{ kind: "confirm", message: "Continue?" }] };
    const column: ColumnDef = { ...buttonColumn, buttonConfig: config };
    expect(updateRecordButtonStyle(column, "primary")).toBe(true);
    expect(column.buttonConfig).toEqual({ ...config, style: "primary" });
    expect(column.buttonConfig?.actions).toBe(config.actions);
    expect(column.buttonConfig?.steps).toBe(config.steps);
    expect(updateRecordButtonStyle(column, "primary")).toBe(false);
    expect(updateRecordButtonStyle(column, "default")).toBe(true);
    expect(column.buttonConfig).toEqual({ ...config, style: "default" });
  });
  it("initializes an unconfigured button without touching other property types", () => {
    const column: ColumnDef = { key: "run", label: "Run", type: "button" };
    expect(updateRecordButtonStyle(column, "default")).toBe(false);
    expect(updateRecordButtonStyle(column, "plain")).toBe(true);
    expect(column.buttonConfig).toEqual({ label: "Run", actions: [], style: "plain" });
    const text: ColumnDef = { key: "title", label: "Title", type: "text" };
    expect(updateRecordButtonStyle(text, "primary")).toBe(false);
    expect(text.buttonConfig).toBeUndefined();
  });
});


describe("button icon changes", () => {
  it("supports emoji, colored icons and explicit removal without replacing the workflow", () => {
    const config: RecordButtonConfig = { ...buttonColumn.buttonConfig!, style: "primary", confirm: true, icon: "check", steps: [{ kind: "confirm", message: "Continue?" }] };
    const column: ColumnDef = { ...buttonColumn, buttonConfig: config };
    for (const icon of ["✅", "lucide:star@orange", null, "check"]) {
      expect(updateRecordButtonIcon(column, icon)).toBe(true);
      expect(column.buttonConfig).toEqual({ ...config, icon: icon || "" });
      expect(column.buttonConfig?.steps).toBe(config.steps);
      expect(column.buttonConfig?.actions).toBe(config.actions);
      expect(updateRecordButtonIcon(column, icon)).toBe(false);
    }
  });
  it("initializes a button safely and leaves unrelated property types untouched", () => {
    const col: ColumnDef = { key: "run", label: "Run", type: "button" };
    expect(updateRecordButtonIcon(col, "✅")).toBe(true);
    expect(col.buttonConfig).toEqual({ label: "Run", actions: [], icon: "✅" });
    expect(updateRecordButtonIcon(col, null)).toBe(true);
    expect(col.buttonConfig?.icon).toBe("");
    const text: ColumnDef = { key: "name", label: "Name", type: "text" };
    expect(updateRecordButtonIcon(text, "✅")).toBe(false);
    expect(text.buttonConfig).toBeUndefined();
  });
});
