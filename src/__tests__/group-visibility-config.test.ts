import { describe, expect, it, vi } from "vitest";
import { DataSource } from "../data/DataSource";
import { ViewConfig } from "../data/types";

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

describe("empty group visibility view config", () => {
  it("parses and serializes field-level empty group visibility overrides", () => {
    const dataSource = createDataSourceForParsing();
    const parsed = dataSource.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        columns: [{ key: "tags", label: "Tags", type: "multi-select" }],
        computedFields: [],
        views: [{
          id: "view",
          name: "Grouped",
          viewType: "table",
          groupByField: "tags",
          showEmptyGroups: { tags: true, status: false, ignored: "yes" },
        }],
      },
    });

    expect(parsed?.views[0].showEmptyGroups).toEqual({ tags: true, status: false });

    const payload = (dataSource as unknown as {
      toViewPayload(view: ViewConfig): Record<string, unknown>;
    }).toViewPayload({
      id: "view",
      name: "Grouped",
      viewType: "table",
      sourceFolder: "",
      schema: {
        columns: [{ key: "tags", label: "Tags", type: "multi-select" }],
        computedFields: [],
      },
      groupByField: "tags",
      showEmptyGroups: { tags: true },
    });

    expect(payload.showEmptyGroups).toEqual({ tags: true });
  });
});

describe("board subgroup enabled view config", () => {
  it("parses legacy board subgroup fields as enabled and serializes the explicit switch state", () => {
    const dataSource = createDataSourceForParsing();
    const legacy = dataSource.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        columns: [
          { key: "status", label: "Status", type: "status" },
          { key: "priority", label: "Priority", type: "select" },
        ],
        computedFields: [],
        views: [{
          id: "view",
          name: "Board",
          viewType: "board",
          boardGroupField: "status",
          boardSubgroupField: "priority",
        }],
      },
    });

    expect(legacy?.views[0].boardSubgroupField).toBe("priority");
    expect(legacy?.views[0].boardSubgroupEnabled).toBe(true);

    const parsed = dataSource.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        columns: [
          { key: "status", label: "Status", type: "status" },
          { key: "priority", label: "Priority", type: "select" },
        ],
        computedFields: [],
        views: [{
          id: "view",
          name: "Board",
          viewType: "board",
          boardGroupField: "status",
          boardSubgroupEnabled: true,
        }],
      },
    });

    expect(parsed?.views[0].boardSubgroupEnabled).toBe(true);
    expect(parsed?.views[0].boardSubgroupField).toBeUndefined();

    const payload = (dataSource as unknown as {
      toViewPayload(view: ViewConfig): Record<string, unknown>;
    }).toViewPayload({
      id: "view",
      name: "Board",
      viewType: "board",
      sourceFolder: "",
      schema: {
        columns: [
          { key: "status", label: "Status", type: "status" },
          { key: "priority", label: "Priority", type: "select" },
        ],
        computedFields: [],
      },
      boardGroupField: "status",
      boardSubgroupEnabled: true,
      boardSubgroupField: "priority",
    });

    expect(payload.boardSubgroupEnabled).toBe(true);
    expect(payload.boardSubgroupField).toBe("priority");
  });
});
