import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterDraftChangesToResolvedConflicts,
  filterPropertyTypeConflictsForChange,
  findPropertyTypeConflicts,
  getPropertyTypeConflictEntryId,
  getPropertyTypeConflictTypeLabel,
  getPropertyWriters,
  isPropertyTypeConflictResolvedWithDrafts,
  mapColumnTypeToObservablePropertyType,
} from "../data/PropertyTypeConflict";
import { DatabaseConfig } from "../data/types";

function database(overrides: Partial<DatabaseConfig>): DatabaseConfig {
  return {
    id: overrides.id || "db",
    name: overrides.name || "Database",
    sourceFolder: overrides.sourceFolder || "",
    schema: overrides.schema || { columns: [], computedFields: [] },
    views: overrides.views || [],
    computedSyncMode: overrides.computedSyncMode,
  };
}

describe("property type conflicts", () => {
  it("checks property type conflicts before binding a column to a different frontmatter key", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(source).toContain("confirmPropertyTypeConflictBeforeColumnRename");
    expect(source).toContain("buildProspectivePropertyConflictEntriesForRename");
  });

  it("checks property type conflicts before saving computed formula result types", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(source).toContain("confirmPropertyTypeConflictBeforeFormulaSave");
    expect(source).toContain("buildProspectivePropertyConflictEntriesForComputedType");
  });

  it("checks property type conflicts before creating or importing database configs", () => {
    const dashboardSource = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const pluginSource = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const settingsSource = readFileSync(new URL("../settings.ts", import.meta.url), "utf8");

    expect(dashboardSource).toContain("confirmNewDatabasePropertyTypeConflicts");
    expect(pluginSource).toContain("confirmNewDatabasePropertyTypeConflicts");
    expect(settingsSource).toContain("confirmNewDatabasePropertyTypeConflicts");
    expect(pluginSource.match(/confirmNewDatabasePropertyTypeConflicts/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("models computed storage key changes when checking property rename conflicts", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const start = source.indexOf("private buildProspectivePropertyConflictEntriesForRename");
    const end = source.indexOf("private buildPropertyConflictEntries", start);
    const method = source.slice(start, end);

    expect(method).toContain("oldComputedKey");
    expect(method).toContain("newComputedKey");
    expect(method).toContain("computedFields");
  });

  it("maps plugin column types to Obsidian-observable storage types", () => {
    expect(mapColumnTypeToObservablePropertyType("text")).toBe("text");
    expect(mapColumnTypeToObservablePropertyType("select")).toBe("text");
    expect(mapColumnTypeToObservablePropertyType("status")).toBe("text");
    expect(mapColumnTypeToObservablePropertyType("multi-select")).toBe("multitext");
    expect(mapColumnTypeToObservablePropertyType("number")).toBe("number");
    expect(mapColumnTypeToObservablePropertyType("currency")).toBe("number");
    expect(mapColumnTypeToObservablePropertyType("date")).toBe("date");
    expect(mapColumnTypeToObservablePropertyType("datetime")).toBe("datetime");
    expect(mapColumnTypeToObservablePropertyType("checkbox")).toBe("checkbox");
    expect(mapColumnTypeToObservablePropertyType("computed")).toBeNull();
  });

  it("does not report display formatter differences as conflicts", () => {
    const conflicts = findPropertyTypeConflicts([
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [
              { key: "url", label: "URL", type: "text", textRenderMode: "link" },
              { key: "score", label: "Score", type: "number", numberDisplayStyle: "progress" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "url", label: "URL", type: "text", textRenderMode: "markdown" },
              { key: "score", label: "Score", type: "currency" },
            ],
            computedFields: [],
          },
        }),
      },
    ]);

    expect(conflicts).toEqual([]);
  });

  it("keeps text, select, and status compatible while flagging multi-select", () => {
    const conflicts = findPropertyTypeConflicts([
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [
              { key: "stage", label: "Stage", type: "text" },
              { key: "tags2", label: "Tags", type: "multi-select" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "stage", label: "Stage", type: "status" },
              { key: "tags2", label: "Tags", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe("tags2");
    expect(conflicts[0].observableTypes).toEqual(["multitext", "text"]);
    expect(conflicts[0].kind).toBe("type");
  });

  it("treats date and datetime as a precision conflict", () => {
    const conflicts = findPropertyTypeConflicts([
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: { columns: [{ key: "when", label: "When", type: "date" }], computedFields: [] },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          schema: { columns: [{ key: "when", label: "When", type: "datetime" }], computedFields: [] },
        }),
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("date-precision");
  });

  it("ignores display-only computed fields and includes saved computed fields", () => {
    const displayOnlyWriters = getPropertyWriters([
      {
        sourcePath: "A.md",
        config: database({
          computedSyncMode: "display-only",
          schema: {
            columns: [{ key: "formula.score", label: "Score", type: "computed", computedKey: "score" }],
            computedFields: [{ key: "score", label: "Score", expression: "1", type: "number" }],
          },
        }),
      },
    ]);
    expect(displayOnlyWriters).toEqual([]);

    const savedWriters = getPropertyWriters([
      {
        sourcePath: "A.md",
        config: database({
          computedSyncMode: "manual",
          schema: {
            columns: [{ key: "formula.score", label: "Score", type: "computed", computedKey: "score" }],
            computedFields: [{ key: "score", label: "Score", expression: "1", type: "number" }],
          },
        }),
      },
    ]);
    expect(savedWriters).toMatchObject([
      { key: "score", sourceKind: "computed", observableType: "number", computedSyncMode: "manual" },
    ]);
  });

  it("reports conflicts caused by saved computed field writers", () => {
    const conflicts = findPropertyTypeConflicts([
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [{ key: "score", label: "Score", type: "text" }],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          computedSyncMode: "automatic",
          schema: {
            columns: [{ key: "formula.score", label: "Score Formula", type: "computed", computedKey: "score" }],
            computedFields: [{ key: "score", label: "Score Formula", expression: "1", type: "number" }],
          },
        }),
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      key: "score",
      involvesComputed: true,
      observableTypes: ["number", "text"],
    });
  });

  it("uses stable entry ids and labels for modal grouping", () => {
    expect(getPropertyTypeConflictEntryId({
      config: { ...database({ name: "Untitled" }), id: "" },
      sourcePath: "Folder/Db.md",
    })).toBe("Folder/Db.md");
    expect(getPropertyTypeConflictTypeLabel("multitext")).toBe("Multi-text");
  });

  it("keeps copied database files with duplicate ids as distinct writers", () => {
    const conflicts = findPropertyTypeConflicts([
      {
        sourcePath: "database/Original.md",
        config: database({
          id: "copied-id",
          name: "Copied",
          schema: { columns: [{ key: "shared", label: "Shared", type: "text" }], computedFields: [] },
        }),
      },
      {
        sourcePath: "database/Copy 1.md",
        config: database({
          id: "copied-id",
          name: "Copied",
          schema: { columns: [{ key: "shared", label: "Shared", type: "text" }], computedFields: [] },
        }),
      },
      {
        sourcePath: "database/Copy 2.md",
        config: database({
          id: "copied-id",
          name: "Copied",
          schema: { columns: [{ key: "shared", label: "Shared", type: "number" }], computedFields: [] },
        }),
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].writers.map((writer) => writer.databasePath)).toEqual([
      "database/Copy 1.md",
      "database/Copy 2.md",
      "database/Original.md",
    ]);
  });

  it("filters modal draft changes to conflicts that are resolved", () => {
    const conflicts = findPropertyTypeConflicts([
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [
              { key: "first", label: "First", type: "number" },
              { key: "second", label: "Second", type: "number" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "first", label: "First", type: "text" },
              { key: "second", label: "Second", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
    ]);
    const first = conflicts.find((conflict) => conflict.key === "first");
    const second = conflicts.find((conflict) => conflict.key === "second");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    const drafts = [
      { databaseId: "a", databasePath: "A.md", key: "first", sourceKind: "column" as const, type: "text" as const },
      { databaseId: "b", databasePath: "B.md", key: "first", sourceKind: "column" as const, type: "text" as const },
      { databaseId: "a", databasePath: "A.md", key: "second", sourceKind: "column" as const, type: "number" as const },
      { databaseId: "b", databasePath: "B.md", key: "second", sourceKind: "column" as const, type: "text" as const },
    ];

    expect(isPropertyTypeConflictResolvedWithDrafts(first!, drafts)).toBe(true);
    expect(isPropertyTypeConflictResolvedWithDrafts(second!, drafts)).toBe(false);
    expect(filterDraftChangesToResolvedConflicts(conflicts, drafts).map((draft) => draft.key)).toEqual(["first", "first"]);
  });

  it("does not surface unchanged unrelated conflicts when changing a non-conflicting field", () => {
    const beforeEntries = [
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [
              { key: "legacy", label: "Legacy", type: "number" },
              { key: "new_field", label: "New", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "legacy", label: "Legacy", type: "text" },
              { key: "new_field", label: "New", type: "number" },
            ],
            computedFields: [],
          },
        }),
      },
    ];
    const afterEntries = [
      beforeEntries[0],
      {
        ...beforeEntries[1],
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "legacy", label: "Legacy", type: "text" },
              { key: "new_field", label: "New", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
    ];

    const relevant = filterPropertyTypeConflictsForChange(
      findPropertyTypeConflicts(beforeEntries),
      findPropertyTypeConflicts(afterEntries),
      afterEntries[1],
      "new_field",
    );

    expect(findPropertyTypeConflicts(afterEntries).map((conflict) => conflict.key)).toEqual(["legacy"]);
    expect(relevant).toEqual([]);
  });

  it("surfaces a conflict introduced by binding a column to an existing conflicting frontmatter key", () => {
    const beforeEntries = [
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [
              { key: "existing", label: "Existing", type: "number" },
              { key: "new_field", label: "New", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "existing", label: "Existing", type: "number" },
            ],
            computedFields: [],
          },
        }),
      },
    ];
    const afterEntries = [
      {
        ...beforeEntries[0],
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [
              { key: "existing", label: "Existing", type: "number" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        ...beforeEntries[1],
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "existing", label: "Existing", type: "number" },
              { key: "existing", label: "New", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
    ];

    const relevant = filterPropertyTypeConflictsForChange(
      findPropertyTypeConflicts(beforeEntries),
      findPropertyTypeConflicts(afterEntries),
      afterEntries[1],
      "existing",
    );

    expect(relevant).toHaveLength(1);
    expect(relevant[0]).toMatchObject({ key: "existing", observableTypes: ["number", "text"] });
  });

  it("surfaces a conflict when binding a new column to an already conflicting frontmatter key", () => {
    const beforeEntries = [
      {
        sourcePath: "A.md",
        config: database({
          id: "a",
          name: "A",
          schema: {
            columns: [
              { key: "existing", label: "Existing", type: "number" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "B.md",
        config: database({
          id: "b",
          name: "B",
          schema: {
            columns: [
              { key: "existing", label: "Existing", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
      {
        sourcePath: "C.md",
        config: database({
          id: "c",
          name: "C",
          schema: {
            columns: [
              { key: "new_field", label: "New", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
    ];
    const afterEntries = [
      beforeEntries[0],
      beforeEntries[1],
      {
        ...beforeEntries[2],
        config: database({
          id: "c",
          name: "C",
          schema: {
            columns: [
              { key: "existing", label: "New", type: "text" },
            ],
            computedFields: [],
          },
        }),
      },
    ];

    const relevant = filterPropertyTypeConflictsForChange(
      findPropertyTypeConflicts(beforeEntries),
      findPropertyTypeConflicts(afterEntries),
      afterEntries[2],
      "existing",
    );

    expect(findPropertyTypeConflicts(beforeEntries)).toHaveLength(1);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].writers.map((writer) => writer.databaseId)).toEqual(["a", "b", "c"]);
  });
});
