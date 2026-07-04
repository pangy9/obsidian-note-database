import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("calendar timeline feedback fixes", () => {
  it("saves manual rank created during calendar entry creation without adding a view-config undo item", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(dashboard).toContain("skipHistory?: boolean");
    expect(dashboard).toContain("this.scheduleConfigSave({ skipHistory: true })");
    expect(dashboard).toContain("if (metadata?.skipHistory && !metadata.undoLabel");
    expect(dashboard).toContain("skipHistory: (existing.skipHistory || next.skipHistory)");
  });

  it("separates inherited status preset choices from the presets managed at the current settings level", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(panel).toContain("managedPresetCount?: number");
    expect(panel).toContain("helpText?: string");
    expect(panel).toContain("field.createDiv({ cls: \"db-view-config-help\", text: options.helpText })");
    expect(dashboard).toContain("managedStatusPresetCount: db.statusPresets?.length || 0");
    expect(dashboard).toContain("managedViewStatusPresetCount: config.statusPresets?.length || 0");
    expect(dashboard).toContain("getStatusPresetsForLevel(\"database\", db)");
    expect(dashboard).toContain("getStatusPresetsForLevel(\"view\", db, config)");
    expect(i18n).toContain("\"viewConfig.statusPreset.help\"");
  });

  it("keeps calendar cells responsive and derives visible event count from cell height", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    const calendarRenderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(renderer).not.toContain("getCalendarVisibleEventLimit(config)");
    expect(renderer).not.toContain("this.getCalendarCellMinHeight(config)");
    expect(calendarRenderer).not.toContain("MAX_VISIBLE_CALENDAR_EVENTS");
    expect(renderer).not.toContain("renderCalendarResizeHandle(button, event, \"start\")");
    expect(styles).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(styles).toContain(".note-database-container .db-calendar-grid");
    expect(styles).toContain("pointer-events: none");
    expect(styles).toContain("pointer-events: auto");
  });

  it("shows the toolbar sort control for calendar and timeline views", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");

    expect(toolbar).toContain("const showSortButton = viewType !== \"chart\";");
    expect(toolbar).not.toContain("const showSortButton = viewType !== \"chart\" && viewType !== \"timeline\"");
    expect(toolbar).not.toContain("const showSortButton = viewType !== \"chart\" && viewType !== \"calendar\" && viewType !== \"timeline\"");
  });

  it("shows the same calendar sort hint for month, week, and day views", () => {
    const sortPanel = readFileSync(new URL("../views/SortPanelRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(sortPanel).toContain("if (config.viewType === \"calendar\")");
    expect(sortPanel).not.toContain("(config.calendarScale || \"month\") === \"month\"");
    expect(sortPanel).toContain("sortPanel.calendarHint");
    expect(sortPanel).not.toContain("sortPanel.calendarMonthHint");
    expect(i18n).toContain("\"sortPanel.calendarHint\"");
    expect(i18n).not.toContain("\"sortPanel.calendarMonthHint\"");
  });

  it("shows property columns control for calendar/timeline; hides view status preset where it does not affect the view", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");

    expect(toolbar).toContain("const showColumnButton = viewType !== \"chart\"");
    expect(toolbar).toContain("if (showColumnButton) this.renderColumnButton");
    expect(panel).toContain("const showViewStatusPresets = config.viewType !== \"chart\" && config.viewType !== \"calendar\" && config.viewType !== \"timeline\"");
    expect(panel).toContain("if (showViewStatusPresets)");
  });

  it("disables timeline manual reorder when grouped by read-only file fields", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");

    expect(renderer).toContain("config.timelineGroupField?.startsWith(\"file.\")");
    expect(renderer).toContain("return false");
  });
});
