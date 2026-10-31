import { describe, expect, it, vi } from "vitest";
import { buildCalendarMonthModel } from "../data/CalendarTimelineModel";
import { buildCalendarMonthWeekLayouts } from "../data/CalendarLayoutModel";
import { applyConditionalFormat } from "../data/ConditionalFormatting";
import type { RowData, ViewConfig } from "../data/types";

vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: vi.fn() }));

const config: ViewConfig = {
  name: "Calendar view", sourceFolder: "", viewType: "calendar",
  schema: {
    columns: [
      { key: "todo_status", label: "Status", type: "status", statusOptions: [
        { value: "1 To Do", color: "blue" }, { value: "2 In Progress", color: "green" },
      ] },
      { key: "date_created", label: "Start", type: "date" },
      { key: "due_date", label: "End", type: "date" },
    ], computedFields: [],
  },
  calendarStartDateField: "date_created", calendarEndDateField: "due_date",
  calendarColorField: "todo_status", conditionalFormats: [],
};
const rows: RowData[] = ["1 To Do", "2 In Progress"].map((status, index) => ({
  file: { path: `${index}.md`, name: `${index}.md`, basename: String(index) } as RowData["file"],
  frontmatter: { todo_status: status, date_created: "2026-10-05", due_date: index ? "2026-10-23" : "2026-10-05" },
  computed: {},
}));
const matchingConfig: ViewConfig = { ...config, conditionalFormats: [{
  id: "override", target: "record", color: "red",
  condition: { field: "todo_status", op: "eq", value: "1 To Do" },
}] };

// Minimal DOM style/class/attribute surface. Production model, layout, filter,
// and conditional-format functions run unchanged; no Obsidian app is needed.
function elementWithEventColor(color?: string): HTMLElement {
  const styles = new Map<string, { value: string; priority: string }>();
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const element = {
    style: {
      setProperty: (key: string, value: string, priority = "") => { styles.set(key, { value, priority }); },
      getPropertyValue: (key: string) => styles.get(key)?.value || "",
      getPropertyPriority: (key: string) => styles.get(key)?.priority || "",
      removeProperty: (key: string) => { styles.delete(key); },
    },
    addClass: (name: string) => { classes.add(name); },
    removeClass: (name: string) => { classes.delete(name); },
    hasClass: (name: string) => classes.has(name),
    setAttribute: (key: string, value: string) => { attributes.set(key, value); },
    getAttribute: (key: string) => attributes.get(key) ?? null,
    removeAttribute: (key: string) => { attributes.delete(key); },
  } as unknown as HTMLElement;
  if (color) {
    for (const key of ["--card-bg", "--db-calendar-event-bg"]) element.style.setProperty(key, `var(--status-color-bg-${color})`);
    for (const key of ["--card-accent", "--db-calendar-event-accent"]) element.style.setProperty(key, `var(--status-color-fg-${color})`);
  }
  return element;
}

describe("issue #9: event color survives conditional formatting", () => {
  it("retains status colors on short and multi-week month segments with no rules", () => {
    const model = buildCalendarMonthModel(rows, config, { year: 2026, monthIndex: 9 });
    const segments = buildCalendarMonthWeekLayouts(model.weeks, config).flatMap((week) => week.segments);
    expect(segments.filter((segment) => segment.event.filePath === "1.md").length).toBeGreaterThan(1);
    for (const { event } of segments) {
      const color = event.filePath === "0.md" ? "blue" : "green";
      expect(event.color).toBe(color);
      const element = elementWithEventColor(event.color);
      applyConditionalFormat(element, event.row, config, undefined);
      expect(element.style.getPropertyValue("--db-calendar-event-bg")).toBe(`var(--status-color-bg-${color})`);
      expect(element.style.getPropertyValue("--db-calendar-event-accent")).toBe(`var(--status-color-fg-${color})`);
    }
  });

  it("retains event color when no conditional rule matches", () => {
    const element = elementWithEventColor("green");
    applyConditionalFormat(element, rows[1], matchingConfig, undefined);
    expect(element.style.getPropertyValue("--db-calendar-event-bg")).toBe("var(--status-color-bg-green)");
  });

  it("lets matching rules override event color and restores it when rules are removed", () => {
    const element = elementWithEventColor("blue");
    // Repeated application must not replace the saved base color with the override.
    for (let i = 0; i < 2; i++) {
      applyConditionalFormat(element, rows[0], matchingConfig, undefined);
      expect(element.style.getPropertyValue("--db-calendar-event-bg")).toBe("var(--status-color-bg-red)");
      expect(element.getAttribute("data-note-database-conditional-rule")).toBe("override");
    }
    applyConditionalFormat(element, rows[0], config, undefined);
    for (const key of ["--card-bg", "--db-calendar-event-bg"]) expect(element.style.getPropertyValue(key)).toBe("var(--status-color-bg-blue)");
    for (const key of ["--card-accent", "--db-calendar-event-accent"]) expect(element.style.getPropertyValue(key)).toBe("var(--status-color-fg-blue)");
    expect(element.hasClass("db-conditional-format")).toBe(false);
    expect(element.getAttribute("data-note-database-conditional-rule")).toBeNull();
    expect(element.style.getPropertyValue("--db-conditional-format-bg")).toBe("");
  });

  it("cleans up previous rule colors on reused elements without an event color", () => {
    const element = elementWithEventColor();
    applyConditionalFormat(element, rows[0], matchingConfig, undefined);
    applyConditionalFormat(element, rows[1], matchingConfig, undefined);
    expect(element.style.getPropertyValue("--db-calendar-event-bg")).toBe("");
    expect(element.style.getPropertyValue("--card-bg")).toBe("");
    expect(element.hasClass("db-conditional-format")).toBe(false);
  });
});
