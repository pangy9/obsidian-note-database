import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CREATION_DEFAULT_VIEW_TYPES, applyNewDatabaseDefaults, applyNewViewDefaults, getDefaultKeys, getDisplayedDefault, hasViewDefaultOverride,
  normalizeNewViewDefaults, updateCreationDefault,
} from "../data/NewViewDefaults";
import type { DatabaseConfig, DatabaseViewType, ViewConfig } from "../data/types";

const view = (viewType: DatabaseViewType): ViewConfig => ({
  name: "View", viewType, sourceFolder: "", schema: { columns: [], computedFields: [] },
});

describe("creation defaults", () => {
  it("migrates previous toggles but leaves a fresh profile on factory defaults", () => {
    expect(normalizeNewViewDefaults(undefined)).toEqual({ database: {}, shared: {}, views: {} });
    expect(normalizeNewViewDefaults({ showEmptyFields: true, timelineContinuous: false }))
      .toEqual({ database: {}, shared: { showEmptyFields: true }, views: { timeline: { timelineContinuous: false } } });
    expect(normalizeNewViewDefaults({ shared: {}, views: {}, showEmptyFields: true }).shared).toEqual({});
  });

  it("validates values and never carries a field reference or irrelevant setting across databases", () => {
    const defaults = normalizeNewViewDefaults({
      database: { quickFormEnabled: "true", sourceFolder: "Notes" },
      shared: { yearDisplayMode: "smart", chartShowLegend: false },
      views: {
        gallery: { galleryCardSize: 500, galleryImageFit: "contain", galleryImageField: "cover" },
        board: { boardColumnWidth: 300, chartShowLegend: false },
        calendar: { calendarFirstDayOfWeek: 0, calendarWeekSlotDuration: 20 },
        chart: { chartColorPalette: "pastel", chartShowLegend: false },
        form: { showRecordIcon: true },
      },
    });
    expect(defaults).toEqual({
      database: {}, shared: { yearDisplayMode: "smart" },
      views: {
        gallery: { galleryImageFit: "contain" }, board: { boardColumnWidth: 300 },
        calendar: { calendarFirstDayOfWeek: 0 }, chart: { chartColorPalette: "pastel", chartShowLegend: false },
      },
    });
    expect(getDefaultKeys("table")).not.toContain("showEmptyFields");
    expect(getDefaultKeys("chart")).not.toContain("showRecordIcon");
    expect(getDefaultKeys("board")).not.toContain("defaultColumnWidth");
  });

  it("snapshots new views at creation; explicit values win over view, shared and built-in defaults", () => {
    const defaults = normalizeNewViewDefaults({
      shared: { showEmptyFields: true, yearDisplayMode: "smart" },
      views: { board: { showEmptyFields: false, boardColumnWidth: 410 }, calendar: { calendarFirstDayOfWeek: 1 } },
    });
    const existing = view("board");
    const board = view("board");
    const gallery = view("gallery");
    const calendar = { ...view("calendar"), calendarFirstDayOfWeek: 0 as const };
    applyNewViewDefaults(board, defaults);
    applyNewViewDefaults(gallery, defaults);
    applyNewViewDefaults(calendar, defaults);
    updateCreationDefault(defaults, "board", "showEmptyFields", undefined);
    expect(board).toMatchObject({ showEmptyFields: false, yearDisplayMode: "smart", boardColumnWidth: 410 });
    expect(gallery).toMatchObject({ showEmptyFields: true, yearDisplayMode: "smart" });
    expect(calendar.calendarFirstDayOfWeek).toBe(0);
    expect(existing).not.toHaveProperty("showEmptyFields");
    const copy = structuredClone(board);
    expect(copy.showEmptyFields).toBe(false);
    expect(getDisplayedDefault(defaults, "board", "showEmptyFields")).toBe(true);
  });

  it("applies one toolbar width to all eight new view types without exposing it in the popover editor", () => {
    const stored = normalizeNewViewDefaults(JSON.parse(JSON.stringify({ shared: { displayWidth: "wide" } })));
    expect(stored.shared).toEqual({ displayWidth: "wide" });
    expect(getDefaultKeys("shared")).not.toContain("displayWidth");
    expect(CREATION_DEFAULT_VIEW_TYPES).not.toContain("form");
    for (const type of [...CREATION_DEFAULT_VIEW_TYPES, "form"] as const) {
      const target = view(type);
      applyNewViewDefaults(target, stored);
      expect(target.displayWidth).toBe("wide");
    }
    expect(normalizeNewViewDefaults({ shared: { displayWidth: "adaptive" } }).shared).toEqual({});
  });

  it("preserves the shared width from the previous build without keeping hidden per-type overrides", () => {
    const defaults = normalizeNewViewDefaults({
      shared: { displayWidth: "wide" },
      views: { table: { displayWidth: "default", defaultColumnWidth: 300 }, form: { displayWidth: "default" } },
    });
    expect(defaults.views).toEqual({ table: { defaultColumnWidth: 300 } });
    const form = view("form");
    const templateView = { ...view("table"), displayWidth: "default" as const };
    const initialView = view("calendar");
    const existing = view("table");
    const database: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema: form.schema,
      views: [form, templateView, initialView] };
    applyNewDatabaseDefaults(database, defaults);
    expect(database.views.map(v => v.displayWidth)).toEqual(["wide", "default", "wide"]);
    expect(existing).not.toHaveProperty("displayWidth");
  });

  it("applies new-database defaults and fills only the supported settings on its initial views", () => {
    const table = view("table");
    const form = view("form");
    const database: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema: table.schema, views: [table, form] };
    const defaults = normalizeNewViewDefaults({
      database: { quickFormEnabled: true }, shared: { showRecordIcon: true, showEmptyFields: true },
      views: { table: { defaultColumnWidth: 230 } },
    });
    applyNewDatabaseDefaults(database, defaults);
    expect(database.quickFormEnabled).toBe(true);
    expect(table).toMatchObject({ defaultColumnWidth: 230, showRecordIcon: true });
    expect(table.showEmptyFields).toBeUndefined();
    expect(form.showRecordIcon).toBeUndefined();
    database.quickFormEnabled = false;
    applyNewDatabaseDefaults(database, defaults);
    expect(database.quickFormEnabled).toBe(false);
  });

  it("distinguishes Sunday, automatic first day, false and an inherited value in the editor", () => {
    const draft = normalizeNewViewDefaults({ shared: { showRecordIcon: true } });
    updateCreationDefault(draft, "calendar", "calendarFirstDayOfWeek", 0);
    updateCreationDefault(draft, "calendar", "showRecordIcon", false);
    expect(getDisplayedDefault(draft, "calendar", "calendarFirstDayOfWeek")).toBe(0);
    expect(getDisplayedDefault(draft, "calendar", "showRecordIcon")).toBe(false);
    expect(hasViewDefaultOverride(draft, "calendar", "showRecordIcon")).toBe(true);
    updateCreationDefault(draft, "calendar", "calendarFirstDayOfWeek", undefined);
    updateCreationDefault(draft, "calendar", "showRecordIcon", undefined);
    expect(getDisplayedDefault(draft, "calendar", "calendarFirstDayOfWeek")).toBeUndefined();
    expect(getDisplayedDefault(draft, "calendar", "showRecordIcon")).toBe(true);
    expect(hasViewDefaultOverride(draft, "calendar", "showRecordIcon")).toBe(false);
  });

  it("offers chart title visibility, grids and axis names without exposing chart data options", () => {
    const defaults = normalizeNewViewDefaults({
      views: { chart: {
        chartShowTitle: false, chartGridLines: "both", chartAxisNames: "x",
        chartTitle: "Custom title", chartOmitZeroValues: true,
      } },
    });
    const chart = view("chart");
    applyNewViewDefaults(chart, defaults);
    expect(chart).toMatchObject({ chartShowTitle: false, chartGridLines: "both", chartAxisNames: "x" });
    expect(chart).not.toHaveProperty("chartTitle");
    expect(chart).not.toHaveProperty("chartOmitZeroValues");
    const explicit = { ...view("chart"), chartShowTitle: true, chartGridLines: "none" as const };
    applyNewViewDefaults(explicit, defaults);
    expect(explicit).toMatchObject({ chartShowTitle: true, chartGridLines: "none", chartAxisNames: "x" });
    expect(normalizeNewViewDefaults({ views: { chart: { chartGridLines: "x", chartAxisNames: "value" } } }).views).toEqual({});
    expect(getDefaultKeys("gallery")).not.toContain("chartShowTitle");
  });

  it("falls back from the Day default when the new timeline uses a date-only field", () => {
    const defaults = normalizeNewViewDefaults({ views: { timeline: { timelineScale: "day", timelineContinuous: true } } });
    const schema: ViewConfig["schema"] = { columns: [
      { key: "due", label: "Due", type: "date" },
      { key: "start", label: "Start", type: "datetime" },
    ], computedFields: [] };
    const dateOnly = { ...view("timeline"), schema };
    const timed = { ...view("timeline"), schema, timelineStartDateField: "start" };
    const dateOnlyEnd = { ...timed, timelineEndDateField: "due" };
    const explicit = { ...dateOnly, timelineScale: "month" as const };
    for (const target of [dateOnly, timed, dateOnlyEnd, explicit]) applyNewViewDefaults(target, defaults);
    expect(dateOnly).toMatchObject({ timelineScale: "week", timelineContinuous: true });
    expect(dateOnlyEnd).toMatchObject({ timelineScale: "week" });
    expect(timed).toMatchObject({ timelineScale: "day", timelineStartDateField: "start" });
    expect(explicit).toMatchObject({ timelineScale: "month" });
    expect(schema.columns[0].type).toBe("date");
  });

  it("calls the defaulting path only for creation, before persistence", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../settings.ts", import.meta.url), "utf8");
    const database = readFileSync(new URL("../views/modals/AddDatabaseFlow.ts", import.meta.url), "utf8");
    expect(dashboard.match(/applyNewViewDefaults\(/g)).toHaveLength(1);
    expect(dashboard).toMatch(/applyNewViewDefaults\(newView,[\s\S]*?db\.views\.push\(newView\)/);
    expect(dashboard).toMatch(/createDatabaseFromModalResult\([\s\S]+?settings\.newViewDefaults,/);
    expect(settings).toMatch(/createDatabaseFromModalResult\([\s\S]+?settings\.newViewDefaults,/);
    expect(database.indexOf('applyNewDatabaseDefaults(db, typeof defaults === "function"')).toBeGreaterThan(database.indexOf("await prepareConflicts(db)"));
    expect(database.indexOf('applyNewDatabaseDefaults(db, typeof defaults === "function"')).toBeLessThan(database.indexOf("dataSource.createViewDefFile("));
  });
});
