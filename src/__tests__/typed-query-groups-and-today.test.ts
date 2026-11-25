import { expect, it, vi } from "vitest";
import { DatabaseView } from "../views/DatabaseView";
import { EmbeddedDatabaseRenderer } from "../views/EmbeddedDatabaseRenderer";
import { RowPipeline } from "../data/RowPipeline";
import { ToolbarRenderer } from "../views/ToolbarRenderer";
import { ViewConfigPanelRenderer } from "../views/ViewConfigPanelRenderer";
import type { DropdownFieldOptions } from "../views/DropdownField";
import { t } from "../i18n";
import { QueryEngine } from "../data/QueryEngine";
import { getConditionalFormatMatch } from "../data/ConditionalFormatting";
import { getLocalDateKey } from "../data/CalendarDateTime";
import { ViewStateStore } from "../views/ViewStateStore";
import type { DatabaseConfig, RowData, ViewConfig } from "../data/types";
import { setLocale } from "../i18n";
type PickerOptions = { footerAction?: { label: string; onSelect(): void }; includeTime?: boolean; displayText?: string };
const ui = vi.hoisted(() => ({
  dropdown: vi.fn<(options: DropdownFieldOptions) => object>(() => ({ button: {} })),
  picker: vi.fn<(options: PickerOptions) => void>(),
}));
vi.mock("../views/DropdownField", () => ({ createDropdownField: ui.dropdown, closeDropdownForRoot() {} }));
vi.mock("../views/DateValuePicker", () => ({ closeActiveDateValuePicker() {}, renderDateValuePicker: ui.picker }));
vi.mock("obsidian", () => ({
  Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {},
  FileView: class {}, ItemView: class {}, MarkdownRenderChild: class {}, Component: class {}, Scope: class {},
  Modal: class {}, MarkdownView: class {}, TFile: class {}, TFolder: class {},
  Platform: { isMobile: false }, normalizePath(path: string) { return path; },
  Notice: class {}, setIcon() {}, setTooltip() {}, addIcon() {},
}));
setLocale("en");
vi.stubGlobal("moment", () => ({format: () => "2026-11-25"}));
const config = (): ViewConfig => ({
  name: "Formula and rollup",
  sourceFolder: "",
  schema: { columns: [
    { key: "amount", label: "Amount", type: "number" },
    { key: "result", label: "Formula result", type: "computed", computedKey: "result" },
    { key: "roll", label: "Rollup sum", type: "rollup", rollupConfig: { relationField: "items", targetField: "amount", aggregation: "sum" } },
  ], computedFields: [{ key: "result", label: "Formula result", expression: "amount * 1", type: "number" }] },
});
const records = [0.1, 0.0000001, 20].map(amount => ({
  file: { path: `${amount}.md`, name: `${amount}.md`, basename: String(amount) } as unknown as RowData["file"],
  frontmatter: { amount },
}));
const derivedValues = new Map(records.map((record, ix) => [record.file.path, { roll: [15, 6, 4][ix] }]));
it("composes computed formula + derived rollup filtering, sorts by formula, and renders rollup conditional formatting", () => {
  const c = config();
  c.conditionalFormats = [{ id: "rollup", comparison: "typed", condition: { field: "roll", op: "gte", value: "10" }, target: "record", color: "red" }];
  const state = new ViewStateStore().get(0, 0, c);
  state.sortRules = [{ field: "result", direction: "asc" }];
  state.filters = [
    { field: "result", op: "gt", value: "0", comparison: "typed" },
    { field: "roll", op: "gte", value: "5", comparison: "typed" },
  ];
  const rows = new RowPipeline().build(records, c, state, undefined, derivedValues);
  expect(rows.map(row => [row.computed.result, getConditionalFormatMatch(row, c, undefined)?.ruleId ?? null])).toEqual([[1e-7, null], [0.1, "rollup"]]);
});
it.each(["standalone", "embedded"])("%s numeric group preset sorts scientific notation numerically", route => {
  const c = config();
  c.groupByField = "result";
  const state = new ViewStateStore().get(0, 0, c);
  const rows = new RowPipeline().build(records, c, state, undefined, derivedValues);
  expect(rows.map(row => row.computed.result)).toEqual([0.1, 1e-7, 20]);
  const shared = { rows, queryEngine: new QueryEngine(), refresh: vi.fn(), scheduleConfigSave: vi.fn() };
  let setGroupOrderMode: (mode: string) => void;
  if (route === "standalone") {
    const db = Object.assign(Object.create(DatabaseView.prototype), shared, {
      getConfig: () => c, vs: () => state,
    });
    setGroupOrderMode = mode => db.setGroupOrderMode(mode);
  } else {
    const db = Object.assign(Object.create(EmbeddedDatabaseRenderer.prototype), shared, {
      vs: () => state, persistEmbeddedConfigLocally: vi.fn(), renderResults: vi.fn(), saveEmbeddedConfigInBackground: vi.fn(),
    });
    setGroupOrderMode = mode => db.setGroupOrderMode(c, mode);
  }
  const toolbar = Object.assign(Object.create(ToolbarRenderer.prototype), {
    renderGroupPopoverRow: (_panel: unknown, option: { label: string; onClick(): void }) => {
      if (option.label === t("groupOrder.numberAsc")) option.onClick();
    },
  });
  toolbar.addGroupOrderRows({}, c, c.schema.columns[1], { setGroupOrderMode });
  expect(c.groupOrders?.result).toEqual(["1e-7", "0.1", "20"]);
});
class ElementStub {
  children: ElementStub[] = [];
  disabled = false;
  value = "";
  ownerDocument = {};
  onclick?: () => void;
  constructor(readonly tag = "div", readonly options?: { cls?: string; text?: string; attr?: Record<string, string> }) {}
  private add(tag:string, opts?: ElementStub["options"]) { const child = new ElementStub(tag, opts); this.children.push(child); return child; }
  createEl(tag:string,opts?:ElementStub["options"]) { return this.add(tag,opts); }
  createDiv(opts?:ElementStub["options"]) { return this.add("div",opts); }
  createSpan(opts?:ElementStub["options"]) { return this.add("span",opts); }
  empty() { this.children = []; }
  walk(): ElementStub[] { return [this, ...this.children.flatMap(c => c.walk())]; }
}
it.each(["computed", "datetime"])("exposes and executes Dynamic today from the %s conditional format editor", kind => {
  ui.dropdown.mockClear(); ui.picker.mockClear();
  const c = config();
  c.schema.columns.unshift({ key: "when", label: "Date & Time", type: "datetime" });
  c.schema.computedFields[0].type = "datetime";
  c.schema.computedFields[0].expression = "when";
  const db: DatabaseConfig = { name: "DB", id: "db", sourceFolder: "", schema: c.schema, views: [c] };
  const host = new ElementStub();
  const editor = new ViewConfigPanelRenderer() as unknown as { renderConditionalFormatting(...args: unknown[]): void };
  editor.renderConditionalFormatting(host, c, db, { onChange: vi.fn() }, false);
  host.walk().find(node => node.options?.cls?.includes("db-conditional-format-add"))?.onclick?.();
  const dropdownField = ui.dropdown.mock.calls.slice().reverse().find(([o]) => o.className?.includes("db-conditional-format-field"))?.[0];
  expect(dropdownField).toBeDefined();
  ui.picker.mockClear();
  dropdownField!.onChange(kind === "computed" ? "result" : "when");
  const rule = c.conditionalFormats![0];
  expect(rule.condition.op).toBe("eq");
  const datePicker = ui.picker.mock.lastCall?.[0];
  expect(datePicker?.includeTime).toBe(true);
  expect(datePicker?.footerAction?.label).toBe(t("conditionalFormat.dynamicToday"));
  datePicker!.footerAction!.onSelect();
  expect(rule.valueSource).toBe("today");
  expect(ui.picker.mock.lastCall?.[0].displayText).toBe(t("conditionalFormat.dynamicToday"));
  const today = getLocalDateKey(new Date());
  const state = new ViewStateStore().get(0, 0, c);
  const datedRecords = ["00:00","12:00"].map((hhmm, i) => ({ ...records[i], frontmatter: { when: today + "T" + hhmm } }));
  // A literal timestamp still means an instant. The dynamic choice means a day.
  const actualMatch = (row: RowData) => getConditionalFormatMatch(row, c, db)?.ruleId ? "colored" : "uncolored";
  const rows = new RowPipeline().build(datedRecords, c, state);
  expect(rows.map(r => r.computed.result)).toEqual([today + "T00:00", today + "T12:00"]);
  expect(rows.map(actualMatch)).toEqual(["colored", "colored"]);
  rule.valueSource = "literal";
  rule.condition.value = today + "T00:00";
  expect(rows.map(actualMatch)).toEqual(["colored", "uncolored"]);
});

it("keeps saved midnight behavior until the user explicitly chooses Dynamic today again", () => {
  ui.picker.mockClear();
  const c = config();
  c.schema.columns.push({ key: "when", label: "Date & Time", type: "datetime" });
  const rule: NonNullable<ViewConfig["conditionalFormats"]>[number] = {
    id: "old", valueSource: "today", target: "record", color: "red", condition: { field: "when", op: "eq", value: "" },
  };
  c.conditionalFormats = [rule];
  const db: DatabaseConfig = { name: "DB", id: "db", sourceFolder: "", schema: c.schema, views: [c] };
  const host = new ElementStub();
  const onChange = vi.fn();
  const editor = new ViewConfigPanelRenderer() as unknown as { renderConditionalFormatting(...args: unknown[]): void };
  editor.renderConditionalFormatting(host, c, db, { onChange }, false);
  const row: RowData = { file: records[0].file, computed: {}, frontmatter: { when: getLocalDateKey(new Date()) + "T12:00" } };
  expect(rule.comparison).toBeUndefined();
  expect(getConditionalFormatMatch(row, c, db)).toBeNull();
  ui.picker.mock.lastCall?.[0].footerAction?.onSelect();
  expect(onChange).toHaveBeenCalledOnce();
  expect(rule.comparison).toBe("typed");
  expect(getConditionalFormatMatch(row, c, db)?.ruleId).toBe("old");
});
