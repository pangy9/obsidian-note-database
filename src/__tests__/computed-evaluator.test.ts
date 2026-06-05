import { describe, expect, it, vi } from "vitest";
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
    const date = value == null ? new Date() : new Date(value as string | number | Date);
    return {
      format: () => "2026-06-03",
      isValid: () => !Number.isNaN(date.getTime()),
      toDate: () => date,
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
