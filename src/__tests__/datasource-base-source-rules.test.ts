import { describe, expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { DatabaseConfig } from "../data/types";

const { MockTFile } = vi.hoisted(() => ({
  MockTFile: class MockTFile {},
}));

vi.mock("obsidian", () => ({
  TFile: MockTFile,
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
  stringifyYaml: (value: unknown) => JSON.stringify(value),
}));

(globalThis as any).moment = Object.assign(
  (value: unknown) => {
    const date = value == null ? new Date() : new Date(value as any);
    return {
      isValid: () => !Number.isNaN(date.getTime()),
      toDate: () => date,
      format: () => "2026-06-03",
    };
  },
  { isMoment: () => false, ISO_8601: "ISO_8601" }
);

function file(path: string) {
  const name = path.split("/").pop() || path;
  return Object.assign(new MockTFile(), {
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    path,
    extension: "md",
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { size: 1, ctime: 0, mtime: 0 },
  }) as any;
}

describe("DataSource Bases source rules", () => {
  it("matches structural formula.xxx rules against computed field values", () => {
    const high = file("Projects/high.md");
    const low = file("Projects/low.md");
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      [high.path]: { score: 4 },
      [low.path]: { score: 2 },
    };
    const app = {
      vault: {
        getMarkdownFiles: () => [high, low],
        getAbstractFileByPath: () => null,
      },
      metadataCache: {
        getFileCache: (target: { path: string }) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
        getFirstLinkpathDest: () => null,
      },
    } as any;
    const db: DatabaseConfig = {
      id: "db",
      name: "DB",
      sourceFolder: "",
      sourceRules: [{ field: "formula.double", op: "gt", value: "5" }],
      schema: {
        columns: [
          { key: "score", label: "Score", type: "number" },
          { key: "formula.double", label: "Double", type: "computed", computedKey: "double" },
        ],
        computedFields: [
          { key: "double", label: "Double", expression: "note.score * 2", type: "number", expressionSyntax: "base" },
        ],
      },
      views: [],
    };

    expect(new DataSource(app).getRecordsForDatabase(db).map((record) => record.file.path)).toEqual(["Projects/high.md"]);
  });

  it("compares typed date range rules as dates", () => {
    const early = file("Projects/early.md");
    const late = file("Projects/late.md");
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      [early.path]: { due: "2024-01-09" },
      [late.path]: { due: "2024-01-10T12:00:00" },
    };
    const app = {
      vault: {
        getMarkdownFiles: () => [early, late],
        getAbstractFileByPath: () => null,
      },
      metadataCache: {
        getFileCache: (target: { path: string }) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
        getFirstLinkpathDest: () => null,
      },
    } as any;
    const db: DatabaseConfig = {
      id: "db",
      name: "DB",
      sourceFolder: "",
      sourceRules: [{ field: "due", op: "gt", value: "2024-01-10", valueType: "date" }],
      schema: {
        columns: [{ key: "due", label: "Due", type: "date" }],
        computedFields: [],
      },
      views: [],
    };

    expect(new DataSource(app).getRecordsForDatabase(db).map((record) => record.file.path)).toEqual(["Projects/late.md"]);
  });
});
