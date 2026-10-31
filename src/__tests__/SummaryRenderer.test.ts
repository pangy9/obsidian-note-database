import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputedFieldDef, DatabaseConfig, RowData, ViewConfig } from "../data/types";
import { SummaryRenderer } from "../views/SummaryRenderer";
import { setLocale } from "../i18n";
import { openDropdownMenu } from "../views/DropdownField";

setLocale("en");
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

vi.mock("../views/DropdownField", () => ({ openDropdownMenu: vi.fn() }));
vi.mock("../views/PropertyTypeIcon", () => ({
  getPropertyDropdownIcon: vi.fn(),
  renderDropdownPropertyTypeIcon: vi.fn(),
}));
vi.mock("../data/FileFieldObsidian", () => ({
  getRowFileFieldValue: vi.fn(),
}));

// Only the element methods used by the non-interactive summary rendering paths.
class SummaryElement {
  children: SummaryElement[] = [];
  text: string;
  cls: string;
  dataset: Record<string, string> = {};
  onclick?: (event: MouseEvent) => void;

  constructor(options: { text?: string; cls?: string } = {}) {
    this.text = options.text || "";
    this.cls = options.cls || "";
  }

  createDiv(options: { text?: string; cls?: string }): SummaryElement {
    const child = new SummaryElement(options);
    this.children.push(child);
    return child;
  }

  createSpan(options: { text?: string; cls?: string }): SummaryElement {
    return this.createDiv(options);
  }

  querySelector(): null { return null; }
  querySelectorAll(): SummaryElement[] { return []; }
  addClass(): void { /* Drag behavior is outside these tests. */ }
  addEventListener(): void { /* Drag behavior is outside these tests. */ }
  setAttribute(): void { /* Drag behavior is outside these tests. */ }

  values(className: string): string[] {
    return [
      ...(this.cls === className ? [this.text] : []),
      ...this.children.flatMap((child) => child.values(className)),
    ];
  }
}

function renderSummary(
  values: unknown[],
  type: ComputedFieldDef["type"],
  grouped: boolean,
  summary = "UNIQUE",
  customFormula?: string,
  computed = true,
): string {
  const config: ViewConfig = {
    name: "Test",
    sourceFolder: "",
    schema: {
      columns: [{ key: "result", label: "Result", type: computed ? "computed" : type }],
      computedFields: computed ? [{ key: "result", label: "Result", expression: "prop('time')", type }] : [],
    },
    summaryRules: [{ field: "result", summary }],
  };
  const rows: RowData[] = values.map((value) => ({
    file: { path: "test.md" } as RowData["file"],
    frontmatter: { result: value },
    computed: { result: value },
  }));
  const parent = new SummaryElement();
  const database = customFormula ? { summaryFormulas: { [summary]: customFormula } } as DatabaseConfig : undefined;
  const renderer = new SummaryRenderer();
  if (grouped) renderer.renderGroupItems(parent as unknown as HTMLElement, rows, config, database);
  else renderer.render(parent as unknown as HTMLElement, rows, config, database);
  const results = parent.values(grouped ? "db-group-summary-value" : "value");
  return results[results.length - 1] || "";
}

describe.each([false, true])("date summaries (grouped: %s)", (grouped) => {
  const times = ["2026-10-19T09:00", "2026-10-19T18:30"];

  it("counts one date for two formula results on the same day", () => {
    expect(renderSummary(times, "date", grouped)).toBe("1");
  });

  it("retains distinct times for datetime and text results", () => {
    expect(renderSummary(times, "datetime", grouped)).toBe("2");
    expect(renderSummary(times, "text", grouped)).toBe("2");
  });

  it("distinguishes dates across days and years and ignores empty results", () => {
    expect(renderSummary([...times, "2026-10-20T09:00", "2025-10-19T09:00", null, undefined, ""], "date", grouped)).toBe("3");
  });

  it("normalizes supported date representations using the displayed calendar day", () => {
    expect(renderSummary([
      "2026-10-19",
      "2026-10-19T23:30:00-07:00",
      new Date("2026-10-19T12:00:00Z"),
      new Date(2026, 9, 19, 15).getTime(),
    ], "date", grouped)).toBe("1");
  });

  it("uses date results in custom unique summaries", () => {
    expect(renderSummary(times, "date", grouped, "Custom", "values.unique().length")).toBe("1");
    expect(renderSummary(times, "date", grouped, "Custom", 'values.unique().join(", ")')).toBe("2026-10-19");
  });

  it("preserves empty counts and invalid values", () => {
    expect(renderSummary([null, undefined, "", ...times], "date", grouped, "EMPTY")).toBe("3");
    expect(renderSummary(["invalid", "invalid", ...times], "date", grouped)).toBe("2");
  });

  it("also respects the date type for ordinary properties", () => {
    expect(renderSummary(times, "date", grouped, "UNIQUE", undefined, false)).toBe("1");
  });

  it("calculates date ranges using days rather than hidden times", () => {
    expect(renderSummary(times, "date", grouped, "RANGE")).toBe("0");
    expect(renderSummary([...times, "2026-10-20T09:00"], "date", grouped, "RANGE")).toBe("1d");
  });

  it("shows the correct calendar day for earliest and latest dates", () => {
    const dates = [...times, "2026-10-20T09:00"];
    expect(renderSummary(dates, "date", grouped, "EARLIEST")).toBe("2026-10-19");
    expect(renderSummary(dates, "date", grouped, "LATEST")).toBe("2026-10-20");
  });

  it("keeps datetime Date objects on their displayed calendar day", () => {
    const dates = [new Date("2026-10-19T00:30:00Z")];
    expect(renderSummary(dates, "datetime", grouped, "EARLIEST")).toBe("2026-10-19");
    expect(renderSummary(dates, "datetime", grouped, "LATEST")).toBe("2026-10-19");
  });

  it("compares datetime Date objects and strings on the same displayed clock", () => {
    const dates = [new Date("2026-10-19T00:30:00Z"), "2026-10-18T23:30"];
    expect(renderSummary(dates, "datetime", grouped, "EARLIEST")).toBe("2026-10-18");
    expect(renderSummary(dates, "datetime", grouped, "LATEST")).toBe("2026-10-19");
    expect(renderSummary(dates, "datetime", grouped, "RANGE")).toBe("3600000");
  });
});

describe("computed summary menus", () => {
  it.each<ComputedFieldDef["type"]>(["date", "datetime", "number", "checkbox", "text"])("offers operations for the declared %s result type", (type) => {
    vi.stubGlobal("HTMLElement", SummaryElement);
    const parent = new SummaryElement();
    const config: ViewConfig = {
      name: "Test", sourceFolder: "",
      schema: {
        columns: [{ key: "formula.result", label: "Result", type: "computed", computedKey: "formula.result" }],
        computedFields: [{ key: "result", label: "Result", expression: "time", type }],
      },
      summaryRules: [{ field: "formula.result", summary: "COUNT" }],
    };
    const rows: RowData[] = [{ file: {} as RowData["file"], frontmatter: {}, computed: { result: "2026-10-19T09:00" } }];
    new SummaryRenderer().render(parent as unknown as HTMLElement, rows, config, undefined, { onChange: vi.fn() });
    const item = parent.children[0].children.find((child) => child.cls.includes("db-summary-sum-item"))!;
    expect(item.values("value")).toEqual(["1"]);
    item.onclick!({ currentTarget: item } as unknown as MouseEvent);
    const options = vi.mocked(openDropdownMenu).mock.calls[0][0].options.map((option) => option.value);
    const specific = type === "date" || type === "datetime" ? ["EARLIEST", "LATEST", "RANGE"]
      : type === "number" ? ["SUM", "AVERAGE", "MEDIAN", "MIN", "MAX", "RANGE", "STDDEV"]
      : type === "checkbox" ? ["CHECKED", "UNCHECKED"] : [];
    expect(options).toEqual(["", ...specific, "COUNT", "UNIQUE", "EMPTY", "FILLED"]);
  });
});
