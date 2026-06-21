import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { updateColumnKeyReferences } from "../data/ColumnConfig";
import { DataSource } from "../data/DataSource";
import { ViewConfig } from "../data/types";

vi.mock("obsidian", () => ({
  App: class {},
  TFile: class {},
  EventRef: class {},
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
  stringifyYaml: (value: unknown) => JSON.stringify(value),
}));

function createDataSourceForParsing(): DataSource {
  return Object.create(DataSource.prototype) as DataSource;
}

function baseView(): ViewConfig {
  return {
    id: "view-1",
    name: "Events",
    viewType: "table",
    sourceFolder: "",
    schema: {
      columns: [
        { key: "title", label: "Title", type: "text" },
        { key: "start", label: "Start", type: "date" },
        { key: "end", label: "End", type: "date" },
        { key: "status", label: "Status", type: "status" },
      ],
      computedFields: [],
    },
  };
}

describe("calendar and timeline view configuration", () => {
  it("parses persisted calendar and timeline views without falling back to table", () => {
    const dataSource = createDataSourceForParsing();

    const config = dataSource.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        columns: baseView().schema.columns,
        computedFields: [],
        views: [
          {
            id: "calendar-view",
            name: "Calendar",
            viewType: "calendar",
            calendarMonth: "2026-08",
            calendarStartDateField: "start",
            calendarEndDateField: "end",
            calendarTitleField: "title",
            calendarColorField: "status",
            calendarScale: "day",
            calendarDay: "2026-08-15",
            calendarStartHour: 8,
            calendarEndHour: 20,
            calendarHourHeight: 56,
            calendarWeekSlotDuration: 15,
            calendarColumnSizeMode: "custom",
            calendarCustomColumnWidth: 160,
            calendarRowSizeMode: "custom",
            calendarWeekStart: "2026-08-10",
            calendarAllDayMaxLanes: 3,
            calendarFirstDayOfWeek: 1,
            calendarMonthVisibleLanes: 4,
            yearDisplayMode: "smart",
          },
          {
            id: "timeline-view",
            name: "Timeline",
            viewType: "timeline",
            timelineStartDateField: "start",
            timelineEndDateField: "end",
            timelineGroupField: "status",
            timelineTitleField: "title",
            timelineColorField: "status",
            timelineScale: "month",
          },
        ],
      },
    });

    expect(config?.views[0]).toMatchObject({
      viewType: "calendar",
      calendarMonth: "2026-08",
      calendarStartDateField: "start",
      calendarEndDateField: "end",
      calendarTitleField: "title",
      calendarColorField: "status",
      calendarScale: "day",
      calendarDay: "2026-08-15",
      calendarStartHour: 8,
      calendarEndHour: 20,
      calendarHourHeight: 56,
      calendarWeekSlotDuration: 15,
      calendarColumnSizeMode: "custom",
      calendarCustomColumnWidth: 160,
      calendarRowSizeMode: "custom",
      calendarWeekStart: "2026-08-10",
      calendarAllDayMaxLanes: 3,
      calendarFirstDayOfWeek: 1,
      calendarMonthVisibleLanes: 4,
      yearDisplayMode: "smart",
    });
    expect(config?.views[1]).toMatchObject({
      viewType: "timeline",
      timelineStartDateField: "start",
      timelineEndDateField: "end",
      timelineGroupField: "status",
      timelineTitleField: "title",
      timelineColorField: "status",
      timelineScale: "month",
    });
  });

  it("serializes calendar and timeline view fields into the database payload", () => {
    const dataSource = createDataSourceForParsing();
    const payload = (dataSource as unknown as {
      toViewPayload(view: ViewConfig): Record<string, unknown>;
    }).toViewPayload({
      ...baseView(),
      viewType: "timeline",
      calendarMonth: "2026-08",
      calendarStartDateField: "start",
      calendarEndDateField: "end",
      calendarTitleField: "title",
      calendarColorField: "status",
      calendarScale: "week",
      calendarDay: "2026-08-15",
      calendarStartHour: 8,
      calendarEndHour: 20,
      calendarHourHeight: 56,
      calendarWeekSlotDuration: 15,
      calendarColumnSizeMode: "custom",
      calendarCustomColumnWidth: 160,
      calendarRowSizeMode: "custom",
      calendarWeekStart: "2026-08-10",
      calendarAllDayMaxLanes: 3,
      calendarFirstDayOfWeek: 1,
      calendarMonthVisibleLanes: 4,
      timelineStartDateField: "start",
      timelineEndDateField: "end",
      timelineGroupField: "status",
      timelineTitleField: "title",
      timelineColorField: "status",
      timelineScale: "week",
    });

    expect(payload).toMatchObject({
      viewType: "timeline",
      calendarMonth: "2026-08",
      calendarStartDateField: "start",
      calendarEndDateField: "end",
      calendarTitleField: "title",
      calendarColorField: "status",
      calendarScale: "week",
      calendarDay: "2026-08-15",
      calendarStartHour: 8,
      calendarEndHour: 20,
      calendarHourHeight: 56,
      calendarWeekSlotDuration: 15,
      calendarColumnSizeMode: "custom",
      calendarCustomColumnWidth: 160,
      calendarRowSizeMode: "custom",
      calendarWeekStart: "2026-08-10",
      calendarAllDayMaxLanes: 3,
      calendarFirstDayOfWeek: 1,
      calendarMonthVisibleLanes: 4,
      timelineStartDateField: "start",
      timelineEndDateField: "end",
      timelineGroupField: "status",
      timelineTitleField: "title",
      timelineColorField: "status",
      timelineScale: "week",
    });
  });

  it("updates calendar and timeline field references when a column key is renamed", () => {
    const view = {
      ...baseView(),
      viewType: "timeline",
      calendarMonth: "2026-08",
      calendarStartDateField: "start",
      calendarEndDateField: "end",
      calendarTitleField: "title",
      calendarColorField: "status",
      timelineStartDateField: "start",
      timelineEndDateField: "end",
      timelineGroupField: "status",
      timelineTitleField: "title",
      timelineColorField: "status",
    } satisfies ViewConfig;

    expect(updateColumnKeyReferences(view, undefined, "start", "starts_on")).toBe(true);
    expect(updateColumnKeyReferences(view, undefined, "title", "name")).toBe(true);

    expect(view.calendarStartDateField).toBe("starts_on");
    expect(view.timelineStartDateField).toBe("starts_on");
    expect(view.calendarTitleField).toBe("name");
    expect(view.timelineTitleField).toBe("name");
    expect(updateColumnKeyReferences(view, undefined, "status", "state")).toBe(true);
    expect(view.calendarColorField).toBe("state");
    expect(view.timelineColorField).toBe("state");
  });

  it("exposes calendar and timeline in the add-view and view-type controls", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(toolbar).toContain("common.calendarView");
    expect(toolbar).toContain("common.timelineView");
    expect(toolbar).toContain("getViewTypeIcon(\"calendar\")");
    expect(toolbar).toContain("getViewTypeIcon(\"timeline\")");
    expect(panel).toContain("common.calendarView");
    expect(panel).toContain("common.timelineView");
    expect(panel).toContain("icon: \"chart-gantt\"");
    expect(i18n).toContain("\"common.calendarView\"");
    expect(i18n).toContain("\"common.timelineView\"");
  });

  it("renders calendar and timeline field settings in the toolbar options menu", () => {
    const panel = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../views/CalendarTimelineToolbarRenderer.ts", import.meta.url), "utf8");
    const calendarToolbar = readFileSync(new URL("../views/CalendarToolbarRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(panel).not.toContain("renderCalendarSettings(panel, config, actions)");
    expect(panel).not.toContain("renderTimelineSettings(panel, config, actions)");
    expect(calendarToolbar).toContain("config.calendarStartDateField");
    expect(calendarToolbar).toContain("config.calendarEndDateField");
    expect(calendarToolbar).toContain("config.calendarTitleField");
    expect(calendarToolbar).toContain("config.calendarColorField");
    expect(calendarToolbar).toContain("isDateLikeColumnType(");
    expect(calendarToolbar).not.toContain("getColumnDisplayType(col, config.schema.computedFields) === \"date\"");
    expect(toolbar).toContain("config.timelineStartDateField");
    expect(toolbar).toContain("config.timelineEndDateField");
    expect(toolbar).toContain("config.timelineTitleField");
    expect(toolbar).toContain("config.timelineColorField");
    expect(toolbar).toContain("isDateLikeColumnType(");
    expect(toolbar).not.toContain("getColumnDisplayType(col, config.schema.computedFields) === \"date\"");
    expect(panel).not.toContain("config.timelineGroupField || \"\"");
    expect(panel).toContain("!isCalendarTimelineView");
    expect(toolbar).toContain("config.timelineScale");
    expect(i18n).toContain("\"viewConfig.eventStartDateField\"");
    expect(i18n).toContain("\"viewConfig.eventEndDateField\"");
    expect(i18n).toContain("\"viewConfig.eventColorField\"");
    expect(i18n).toContain("\"viewConfig.timelineScale\"");
  });

  it("persists and initializes calendar and timeline settings in embedded views", () => {
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    for (const key of [
      "calendarMonth",
      "calendarStartDateField",
      "calendarEndDateField",
      "calendarTitleField",
      "calendarColorField",
      "calendarCellMinHeight",
      "calendarKeepCellAspectRatio",
      "calendarScale",
      "calendarDay",
      "calendarStartHour",
      "calendarEndHour",
      "calendarHourHeight",
      "calendarWeekSlotDuration",
      "calendarColumnSizeMode",
      "calendarCustomColumnWidth",
      "calendarRowSizeMode",
      "calendarCustomRowHeights",
      "calendarWeekStart",
      "calendarAllDayMaxLanes",
      "calendarFirstDayOfWeek",
      "calendarMonthVisibleLanes",
      "timelineStartDateField",
      "timelineEndDateField",
      "timelineGroupField",
      "timelineTitleField",
      "timelineColorField",
      "timelineScale",
    ]) {
      expect(embedded).toContain(`origView.${key} = this.config.${key}`);
    }

    expect(embedded).toContain("if (value === \"calendar\")");
    expect(embedded).toContain("if (value === \"timeline\")");
    expect(embedded).toContain("config.calendarStartDateField = config.calendarStartDateField || getDefaultEventDateField(config)");
    expect(embedded).toContain("config.timelineStartDateField = config.timelineStartDateField || defaultDateField");
  });
});
