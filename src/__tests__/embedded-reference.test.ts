import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";

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

describe("embed reference generation prefers database id", () => {
  it("serializeCodeBlockReference emits dbId and drops the dbPath branch", () => {
    const source = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    const serializer = source.slice(
      source.indexOf("private serializeCodeBlockReference"),
      source.indexOf("private async copyEmbeddedViewCode"),
    );
    expect(serializer).toContain("`dbId: ${this.currentDbConfig.id}`");
    expect(serializer).not.toContain("dbPath:");
  });

  it("DatabaseView.copyCurrentViewCode prefers dbId with a dbPath fallback", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    expect(source).toContain("entry.config.id ? `dbId: ${entry.config.id}` : `dbPath: ${entry.sourcePath}`");
  });

  it("resolveDatabaseEntry resolves pure dbId references by config.id", () => {
    const source = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    const resolver = source.slice(
      source.indexOf("private resolveDatabaseEntry"),
      source.indexOf("private vs("),
    );
    expect(resolver).toContain("entry.config.id === normalized");
  });
});

describe("parseDatabaseConfig id stability", () => {
  it("round-trips a persisted database.id", () => {
    const ds = createDataSourceForParsing();
    const fm = {
      db_view: true,
      database: { id: "stable-db-1", name: "DB", sourceFolder: "", views: [] },
    };
    expect(ds.parseDatabaseConfig(fm as never)?.id).toBe("stable-db-1");
  });

  it("generates a different temporary id on each parse when database.id is missing", () => {
    // This locks in why the backfill migration is required: without a persisted id,
    // dbId-based embed references would point at an id that changes every scan.
    const ds = createDataSourceForParsing();
    const fm = { db_view: true, database: { name: "DB", sourceFolder: "", views: [] } };
    const a = ds.parseDatabaseConfig(fm as never)?.id;
    const b = ds.parseDatabaseConfig(fm as never)?.id;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("migrateBackfillDatabaseId", () => {
  it("writes a stable id into db_view files missing database.id and leaves others untouched", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "missing.md": { db_view: true, database: { name: "DB" } },
      "hasid.md": { db_view: true, database: { id: "existing", name: "DB" } },
    };
    const processFrontMatter = vi.fn(async (file: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
      const fm = store[file.path];
      fn(fm);
    });

    const ds = Object.create(DataSource.prototype) as {
      app: { fileManager: { processFrontMatter: typeof processFrontMatter } };
      migrateBackfillDatabaseId(targets: { file: { path: string }; id: string }[]): Promise<void>;
    };
    ds.app = { fileManager: { processFrontMatter } };

    await ds.migrateBackfillDatabaseId([
      { file: { path: "missing.md" }, id: "backfilled-1" },
      { file: { path: "hasid.md" }, id: "should-not-apply" },
    ]);

    expect((store["missing.md"].database as Record<string, unknown>).id).toBe("backfilled-1");
    expect((store["hasid.md"].database as Record<string, unknown>).id).toBe("existing");
    expect(processFrontMatter).toHaveBeenCalledTimes(2);
  });
});
