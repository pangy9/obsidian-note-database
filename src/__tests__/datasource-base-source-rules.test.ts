import { describe, expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { DatabaseConfig } from "../data/types";

// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
const _g = globalThis as unknown as Record<string, unknown>;

const { MockTFile } = vi.hoisted(() => ({
  MockTFile: class MockTFile {},
}));

vi.mock("obsidian", () => ({
  TFile: MockTFile,
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
  stringifyYaml: (value: unknown) => JSON.stringify(value),
}));

_g.moment = Object.assign(
  (value: unknown) => {
    const date = value == null ? new Date() : new Date(value as string | number | Date);
    return {
      isValid: () => !Number.isNaN(date.getTime()),
      toDate: () => date,
      format: () => "2026-06-03",
    };
  },
  { isMoment: () => false, ISO_8601: "ISO_8601" }
);

interface MockFile {
  name: string;
  basename: string;
  path: string;
  extension: string;
  parent: { path: string };
  stat: { size: number; ctime: number; mtime: number };
}

function file(path: string): MockFile {
  const name = path.split("/").pop() || path;
  return Object.assign(new MockTFile(), {
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    path,
    extension: "md",
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { size: 1, ctime: 0, mtime: 0 },
  });
}

interface MockApp {
  vault: {
    getMarkdownFiles: () => MockFile[];
    getAbstractFileByPath: () => null;
  };
  metadataCache: {
    getFileCache: (target: { path: string }) => { frontmatter: Record<string, unknown> };
    getFirstLinkpathDest: () => null;
  };
}

describe("DataSource Bases source rules", () => {
  it("matches structural formula.xxx rules against computed field values", () => {
    const high = file("Projects/high.md");
    const low = file("Projects/low.md");
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      [high.path]: { score: 4 },
      [low.path]: { score: 2 },
    };
    const app: MockApp = {
      vault: {
        getMarkdownFiles: () => [high, low],
        getAbstractFileByPath: () => null,
      },
      metadataCache: {
        getFileCache: (target: { path: string }) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
        getFirstLinkpathDest: () => null,
      },
    };
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

    expect(new DataSource(app as unknown as ConstructorParameters<typeof DataSource>[0]).getRecordsForDatabase(db).map((record) => record.file.path)).toEqual(["Projects/high.md"]);
  });

  it("compares typed date range rules as dates", () => {
    const early = file("Projects/early.md");
    const late = file("Projects/late.md");
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      [early.path]: { due: "2024-01-09" },
      [late.path]: { due: "2024-01-10T12:00:00" },
    };
    const app: MockApp = {
      vault: {
        getMarkdownFiles: () => [early, late],
        getAbstractFileByPath: () => null,
      },
      metadataCache: {
        getFileCache: (target: { path: string }) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
        getFirstLinkpathDest: () => null,
      },
    };
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

    expect(new DataSource(app as unknown as ConstructorParameters<typeof DataSource>[0]).getRecordsForDatabase(db).map((record) => record.file.path)).toEqual(["Projects/late.md"]);
  });

  it("evaluates aliases contains as a list (array and comma-string), not a raw substring", () => {
    const arr = file("Projects/arr.md");
    const str = file("Projects/str.md");
    const other = file("Projects/other.md");
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      [arr.path]: { aliases: ["alpha", "beta"] },
      [str.path]: { aliases: "alpha, gamma" },
      [other.path]: { aliases: "delta" },
    };
    const app: MockApp = {
      vault: { getMarkdownFiles: () => [arr, str, other], getAbstractFileByPath: () => null },
      metadataCache: {
        getFileCache: (target: { path: string }) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
        getFirstLinkpathDest: () => null,
      },
    };
    const db: DatabaseConfig = {
      id: "db",
      name: "DB",
      sourceFolder: "",
      sourceRules: [{ field: "aliases", op: "contains", value: "alpha" }],
      schema: { columns: [{ key: "aliases", label: "Aliases", type: "multi-select" }], computedFields: [] },
      views: [],
    };
    // Both the array ["alpha","beta"] and the comma-string "alpha, gamma" match "alpha"
    // via list semantics; "delta" does not.
    const ds = new DataSource(app as unknown as ConstructorParameters<typeof DataSource>[0]);
    expect(ds.getRecordsForDatabase(db).map((record) => record.file.path)).toEqual(["Projects/arr.md", "Projects/str.md"]);

    // Regression: contains must use list membership, not whole-value substring. "alp" is a
    // substring of "alpha" but not a list element, so it must match nothing.
    const dbSubstring: DatabaseConfig = { ...db, sourceRules: [{ field: "aliases", op: "contains", value: "alp" }] };
    expect(ds.getRecordsForDatabase(dbSubstring)).toEqual([]);
  });

  it("evaluates aliases eq/neq as a list (any-element equality), matching Bases/QueryEngine filters", () => {
    const arr = file("Projects/arr.md");
    const str = file("Projects/str.md");
    const other = file("Projects/other.md");
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      [arr.path]: { aliases: ["alpha", "beta"] },
      [str.path]: { aliases: "beta, gamma" },
      [other.path]: { aliases: "delta" },
    };
    const app: MockApp = {
      vault: { getMarkdownFiles: () => [arr, str, other], getAbstractFileByPath: () => null },
      metadataCache: {
        getFileCache: (target: { path: string }) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
        getFirstLinkpathDest: () => null,
      },
    };
    const ds = new DataSource(app as unknown as ConstructorParameters<typeof DataSource>[0]);

    const db = (op: "eq" | "neq", value: string): DatabaseConfig => ({
      id: "db",
      name: "DB",
      sourceFolder: "",
      sourceRules: [{ field: "aliases", op, value }],
      schema: { columns: [{ key: "aliases", label: "Aliases", type: "multi-select" }], computedFields: [] },
      views: [],
    });

    // eq matches when ANY element equals the rule value (array or comma-string),
    // matching QueryEngine's `values.some(compareFilterValue === 0)` list semantics.
    expect(ds.getRecordsForDatabase(db("eq", "alpha")).map((r) => r.file.path)).toEqual(["Projects/arr.md"]);
    expect(ds.getRecordsForDatabase(db("eq", "beta")).map((r) => r.file.path)).toEqual(["Projects/arr.md", "Projects/str.md"]);
    // eq must NOT substring-match: "alph" is a substring of "alpha" but not a list element.
    expect(ds.getRecordsForDatabase(db("eq", "alph"))).toEqual([]);
    // neq is the dual (!baseSourceValuesEqual): keeps rows where NO element equals the value.
    expect(ds.getRecordsForDatabase(db("neq", "beta")).map((r) => r.file.path)).toEqual(["Projects/other.md"]);
  });

  it("migrates legacy flat view-level sourceRules to viewSourceRulesEnabled=true (backward compat)", () => {
    const ds = new DataSource({} as unknown as ConstructorParameters<typeof DataSource>[0]);
    const config = ds.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        sourceFolder: "",
        columns: [],
        computedFields: [],
        views: [{
          id: "v1",
          name: "Table",
          viewType: "table",
          sourceRules: [{ field: "status", op: "eq", value: "active" }],
          sourceLogic: "and",
          // No sourceRuleTree, no viewSourceRulesEnabled → migration must set true
        }],
      },
    });
    expect(config?.views[0].viewSourceRulesEnabled).toBe(true);
    expect(config?.views[0].sourceRules).toEqual([{ field: "status", op: "eq", value: "active" }]);
  });
});
