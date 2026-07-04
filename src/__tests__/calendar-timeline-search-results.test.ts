import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildCalendarTimelineSearchResults, timelineHourRange } from "../data/CalendarTimelineSearchResults";
import { ColumnDef, RowData, ViewConfig } from "../data/types";

function col(key: string, label: string, type: ColumnDef["type"]): ColumnDef {
  return { key, label, type };
}

function config(overrides: Partial<ViewConfig> = {}): ViewConfig {
  return {
    name: "Calendar",
    sourceFolder: "",
    viewType: "calendar",
    schema: {
      columns: [
        col("file.name", "Name", "text"),
        col("start", "Start", "date"),
        col("end", "End", "date"),
        col("title", "Title", "text"),
      ],
      computedFields: [],
    },
    calendarStartDateField: "start",
    calendarEndDateField: "end",
    calendarTitleField: "title",
    timelineStartDateField: "start",
    timelineEndDateField: "end",
    timelineTitleField: "title",
    ...overrides,
  };
}

function row(path: string, frontmatter: Record<string, unknown>): RowData {
  return {
    file: {
      path,
      name: path.split("/").pop() || path,
      basename: (path.split("/").pop() || path).replace(/\.md$/i, ""),
      extension: "md",
      parent: { path: path.includes("/") ? path.split("/").slice(0, -1).join("/") : "" },
      stat: { ctime: 0, mtime: 0, size: 0 },
    } as RowData["file"],
    frontmatter,
    computed: {},
  };
}

describe("CalendarTimelineSearchResults", () => {
  it("counts all matching events separately from events in the current range", () => {
    const results = buildCalendarTimelineSearchResults([
      row("Projects/current.md", { title: "Current", start: "2026-06-10", end: "2026-06-11" }),
      row("Projects/future.md", { title: "Future", start: "2026-08-01", end: "2026-08-02" }),
    ], config(), { startDateKey: "2026-06-01", endDateKey: "2026-06-30" });

    expect(results.totalCount).toBe(2);
    expect(results.visibleCount).toBe(1);
    expect(results.items.map((item) => [item.title, item.inCurrentRange])).toEqual([
      ["Current", true],
      ["Future", false],
    ]);
  });

  it("excludes rows without usable event dates and invalid date ranges", () => {
    const results = buildCalendarTimelineSearchResults([
      row("Projects/missing.md", { title: "Missing date" }),
      row("Projects/backwards.md", { title: "Backwards", start: "2026-06-20", end: "2026-06-18" }),
      row("Projects/valid.md", { title: "Valid", start: "2026-06-21", end: "2026-06-22" }),
    ], config(), { startDateKey: "2026-06-01", endDateKey: "2026-06-30" });

    expect(results.totalCount).toBe(1);
    expect(results.items[0].filePath).toBe("Projects/valid.md");
  });

  it("uses timeline hour ranges for day-scale current-range counts", () => {
    const timelineConfig = config({
      viewType: "timeline",
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
          col("title", "Title", "text"),
        ],
        computedFields: [],
      },
    });
    const results = buildCalendarTimelineSearchResults([
      row("Projects/morning.md", { title: "Morning", start: "2026-06-10T09:00", end: "2026-06-10T10:00" }),
      row("Projects/night.md", { title: "Night", start: "2026-06-10T22:00", end: "2026-06-10T23:00" }),
    ], timelineConfig, timelineHourRange("2026-06-10", 8 * 60, 8));

    expect(results.totalCount).toBe(2);
    expect(results.visibleCount).toBe(1);
    expect(results.items.map((item) => [item.title, item.inCurrentRange])).toEqual([
      ["Morning", true],
      ["Night", false],
    ]);
  });

  it("highlights the jumped-to rendered event with the new-record highlight animation", () => {
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embeddedRenderer = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    for (const source of [databaseView, embeddedRenderer]) {
      expect(source).toContain("pendingSearchResultRevealPath");
      expect(source).toContain("this.pendingSearchResultRevealPath = item.filePath;");
      expect(source).toContain("target.addClass(\"is-new-record-highlight\")");
      expect(source).toContain("target.removeClass(\"is-new-record-highlight\")");
    }
  });

  it("shows calendar and timeline search results only while the search input is focused", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embeddedRenderer = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(toolbar).toContain("onSearchFocus?(): void;");
    expect(toolbar).toContain("actions.onSearchFocus?.();");
    expect(databaseView).toContain("onSearchFocus: () => {");
    expect(embeddedRenderer).toContain("onSearchFocus: () => this.renderCalendarTimelineSearchResultsPanel(config)");

    for (const source of [databaseView, embeddedRenderer]) {
      expect(source).toContain("if (window.activeDocument.activeElement !== searchInput) return;");
      expect(source).toContain("panel.onmousedown = (event) =>");
      expect(source).toContain("event.preventDefault();");
      expect(source).toContain("searchInput.onblur = () =>");
      expect(source).toContain("this.closeCalendarTimelineSearchResultsPanel();");
      expect(source).toContain("searchInput.blur();");
      expect(source).not.toContain("dismissedCalendarTimelineSearchQuery");
    }
  });

  it("renders search results in current-range and outside-range sections without badges", () => {
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embeddedRenderer = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    const searchHighlight = readFileSync(new URL("../views/SearchHighlight.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    for (const source of [databaseView, embeddedRenderer]) {
      expect(source).toContain("renderSection(t(\"search.inCurrentRange\"), currentVisibleItems)");
      expect(source).toContain("renderSection(t(\"search.outsideCurrentRange\"), outsideVisibleItems)");
      expect(source).toContain("db-calendar-search-results-section");
      expect(source).toContain("db-calendar-search-results-section-title");
      expect(source).toContain("renderSearchHighlightedText");
      expect(source).not.toContain("db-calendar-search-result-path");
      expect(source).not.toContain("db-calendar-search-result-badge");
    }
    expect(searchHighlight).toContain("export function renderSearchHighlightedText");
    expect(searchHighlight).toContain("mark.className = \"db-search-highlight\"");
    expect(styles).toContain(".db-calendar-search-results-section-title");
    expect(styles).toContain(".db-calendar-search-results-section .db-calendar-search-result:first-of-type");
    expect(styles).toContain(".db-calendar-search-results-section .db-calendar-search-result:last-of-type");
    expect(styles).toContain("border-bottom: 1px solid var(--background-modifier-border);");
    expect(styles).not.toContain(".db-calendar-search-result.is-current-range {\n  background:");
  });
});
