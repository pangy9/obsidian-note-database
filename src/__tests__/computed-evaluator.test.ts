import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateComputedFields } from "../data/ComputedEvaluator";
import { ColumnDef, ComputedFieldDef } from "../data/types";

// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
const _g = globalThis as unknown as Record<string, unknown>;

vi.mock("obsidian", () => ({
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
}));

_g.moment = Object.assign(
  (value: unknown) => {
    // Parse YYYY-MM-DD with local construction so day()/toDate() are timezone-stable.
    const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
    const date = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : (value == null ? new Date() : new Date(value as string | number | Date));
    return {
      format: () => "2026-06-03",
      isValid: () => !Number.isNaN(date.getTime()),
      toDate: () => date,
      day: () => date.getDay(),
    };
  },
  { isMoment: () => false, ISO_8601: "ISO_8601" }
);

const columns: ColumnDef[] = [
  { key: "estimate", label: "Estimate", type: "number" },
  { key: "double", label: "Double", type: "computed", computedKey: "double" },
  { key: "baseTotal", label: "Base total", type: "computed", computedKey: "baseTotal" },
  { key: "summary", label: "Summary", type: "computed", computedKey: "summary" },
];

interface MockFileObj {
  name: string;
  basename: string;
  path: string;
  extension: string;
  parent: { path: string };
  stat: { size: number; ctime: number; mtime: number };
}

const app = {
  metadataCache: {
    getFileCache: () => null,
    getFirstLinkpathDest: () => null,
  },
} as unknown as Parameters<typeof evaluateComputedFields> extends [unknown, unknown, unknown, infer Ctx | undefined]
  ? Ctx extends { app: unknown } ? { app: Ctx["app"] } : never
  : never;

const file: MockFileObj = {
  name: "task.md",
  basename: "task",
  path: "Projects/task.md",
  extension: "md",
  parent: { path: "Projects" },
  stat: { size: 10, ctime: 0, mtime: 0 },
};

const baseFile: MockFileObj = {
  name: "source.base",
  basename: "source",
  path: "Projects/source.base",
  extension: "base",
  parent: { path: "Projects" },
  stat: { size: 10, ctime: 0, mtime: 0 },
};

describe("evaluateComputedFields", () => {
  it("evaluates mixed note-database and Bases formulas in definition order", () => {
    const defs: ComputedFieldDef[] = [
      { key: "double", label: "Double", expression: "estimate * 2", type: "number" },
      { key: "baseTotal", label: "Base total", expression: "formula.double + note.bonus", type: "text", expressionSyntax: "base" },
      { key: "summary", label: "Summary", expression: "field('baseTotal') + 1", type: "number" },
    ];

    expect(evaluateComputedFields(defs, columns, { estimate: 4, bonus: 3 }, { app, file: file as never })).toEqual({
      double: 8,
      baseTotal: 11,
      summary: 12,
    });
  });

  it("returns null for Bases formulas when file context is unavailable", () => {
    const defs: ComputedFieldDef[] = [
      { key: "baseTotal", label: "Base total", expression: "note.estimate + 1", type: "text", expressionSyntax: "base" },
    ];

    expect(evaluateComputedFields(defs, columns, { estimate: 4 })).toEqual({ baseTotal: null });
  });

  it("passes Bases this context through imported formula evaluation", () => {
    const defs: ComputedFieldDef[] = [
      { key: "summary", label: "Summary", expression: "this.name + ':' + file.name", type: "text", expressionSyntax: "base" },
    ];

    expect(evaluateComputedFields(defs, columns, {}, {
      app,
      file: file as never,
      thisFile: baseFile as never,
      thisFrontmatter: {},
    })).toEqual({
      summary: "source.base:task.md",
    });
  });
});

describe("computed datetime functions and result type (source-level)", () => {
  it("registers HOUR/MINUTE/SECOND/TIME and keeps time on DATEADD for datetime inputs", () => {
    const engine = readFileSync(new URL("../data/ComputedField.ts", import.meta.url), "utf8");
    expect(engine).toContain("hour:");
    expect(engine).toContain("HOUR: context.hour");
    expect(engine).toContain("MINUTE: context.minute");
    expect(engine).toContain("SECOND: context.second");
    expect(engine).toContain("TIME: context.time");
    // 原值带时间时保留时间精度；dateAdd 支持 hour/minute/second unit。
    expect(engine).toContain("formatMoment");
    expect(engine).toContain('"hours"');
    expect(engine).toContain("hasDateTimeValue(originalDate)");
  });

  it("exposes datetime result type, validation and examples in FormulaModal", () => {
    const modal = readFileSync(new URL("../views/modals/FormulaModal.ts", import.meta.url), "utf8");
    expect(modal).toContain('"datetime", "formula.typeDatetime"');
    expect(modal).toContain('type === "datetime"');
    expect(modal).toContain('name: "HOUR"');
    expect(modal).toContain("formula.ex.dateTime");
  });
});

describe("Excel function extensions: TEXT / WEEKDAY / NETWORKDAYS", () => {
  const evalExpr = (expression: string): unknown => {
    const defs: ComputedFieldDef[] = [{ key: "r", label: "R", expression, type: "text" }];
    return evaluateComputedFields(defs, columns, {}, { app, file: file as never }).r;
  };

  it("TEXT formats numbers (thousands / percent / padding / fixed)", () => {
    expect(evalExpr('TEXT(1234.5, "#,##0.00")')).toBe("1,234.50");
    expect(evalExpr('TEXT(0.25, "0%")')).toBe("25%");
    expect(evalExpr('TEXT(5, "00")')).toBe("05");
    expect(evalExpr('TEXT(3.14159, "0.00")')).toBe("3.14");
    expect(evalExpr('TEXT(-1234, "#,##0")')).toBe("-1,234");
  });

  it("WEEKDAY keeps 0-6 default and honors return_type", () => {
    // 2026-06-01 is Monday.
    expect(evalExpr('WEEKDAY("2026-06-01")')).toBe(1);     // default 0-6: Mon=1
    expect(evalExpr('WEEKDAY("2026-06-01", 2)')).toBe(1);  // type 2: Mon=1
    expect(evalExpr('WEEKDAY("2026-06-07", 2)')).toBe(7);  // type 2: Sun=7
    expect(evalExpr('WEEKDAY("2026-06-01", 3)')).toBe(0);  // type 3: Mon=0
  });

  it("NETWORKDAYS counts working days and excludes holidays", () => {
    expect(evalExpr('NETWORKDAYS("2026-06-01", "2026-06-05")')).toBe(5);                    // Mon–Fri
    expect(evalExpr('NETWORKDAYS("2026-06-01", "2026-06-06")')).toBe(5);                    // Saturday not counted
    expect(evalExpr('NETWORKDAYS("2026-06-01", "2026-06-05", "2026-06-01")')).toBe(4);      // exclude the Monday
  });
});
