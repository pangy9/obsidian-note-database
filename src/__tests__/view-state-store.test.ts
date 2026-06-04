/**
 * Tests for ViewStateStore logic.
 * Covers:
 * - BF-020: restore persisted state for each view mode
 * - BF-021: cache invalidation after structural changes
 * - BF-035: prune invalid filters/sortRules/groupByField on restore
 */
import { describe, it, expect, beforeEach } from "vitest";

// ---- Types ----
interface FilterRule { field: string; op: string; value?: string; }
interface SortRule { field: string; direction: "asc" | "desc"; }
type DatabaseViewType = "table" | "board" | "gallery" | "list";

interface ViewModeStateDef {
  hiddenColumns?: string[];
  statusFilter?: string;
  searchText?: string;
  groupByField?: string;
  filterLogic?: "and" | "or";
  filters?: FilterRule[];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  sortRules?: SortRule[];
}

interface ColumnDef { key: string; label: string; type: string; }
interface ViewConfig {
  viewType?: DatabaseViewType;
  viewStates?: Partial<Record<DatabaseViewType, ViewModeStateDef>>;
  hiddenColumns?: string[];
  statusFilter?: string;
  searchText?: string;
  groupByField?: string;
  filterLogic?: "and" | "or";
  filters?: FilterRule[];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  sortRules?: SortRule[];
  schema: { columns: ColumnDef[] };
}

interface DatabaseViewState {
  searchText: string;
  statusFilter: string;
  groupByField: string;
  filters: FilterRule[];
  hiddenColumns: Set<string>;
  filterLogic: "and" | "or";
  sortColumn?: string;
  sortDirection: "asc" | "desc";
  sortRules: SortRule[];
}

// ---- Simplified ViewStateStore ----
class ViewStateStore {
  private states = new Map<string, DatabaseViewState>();

  get(dbIndex: number, viewIndex: number, viewConfig?: ViewConfig): DatabaseViewState {
    const key = `${dbIndex}:${viewIndex}`;
    let state = this.states.get(key);
    if (!state) {
      state = this.create(viewConfig);
      this.states.set(key, state);
    }
    // BF-035: Prune invalid fields from state
    if (state && viewConfig) {
      const validKeys = new Set(viewConfig.schema.columns.map(c => c.key));
      validKeys.add("file.name");
      for (const key of state.hiddenColumns) {
        if (!validKeys.has(key)) state.hiddenColumns.delete(key);
      }
      state.filters = state.filters.filter((rule) => validKeys.has(rule.field));
      state.sortRules = state.sortRules.filter((rule) => validKeys.has(rule.field));
      if (state.sortColumn && !validKeys.has(state.sortColumn)) {
        state.sortColumn = undefined;
        state.sortDirection = "asc";
      }
      if (state.groupByField && !validKeys.has(state.groupByField)) {
        state.groupByField = "";
      }
    }
    return state;
  }

  clear(): void {
    this.states.clear();
  }

  delete(dbIndex: number, viewIndex: number): void {
    this.states.delete(`${dbIndex}:${viewIndex}`);
  }

  persist(viewConfig: ViewConfig, state: DatabaseViewState): void {
    const persisted = this.toPersistedState(state);
    viewConfig.viewStates = { ...(viewConfig.viewStates || {}) };
    const mode = viewConfig.viewType || "table";
    viewConfig.viewStates[mode] = persisted;
    // Also write to top-level for legacy access
    viewConfig.hiddenColumns = persisted.hiddenColumns;
    viewConfig.statusFilter = persisted.statusFilter;
    viewConfig.searchText = persisted.searchText;
    viewConfig.groupByField = persisted.groupByField;
    viewConfig.filterLogic = persisted.filterLogic;
    viewConfig.filters = persisted.filters;
    viewConfig.sortColumn = persisted.sortColumn;
    viewConfig.sortDirection = persisted.sortDirection;
    viewConfig.sortRules = persisted.sortRules;
  }

  getKey(dbIndex: number, viewIndex: number): string {
    return `${dbIndex}:${viewIndex}`;
  }

  private create(viewConfig: ViewConfig | undefined): DatabaseViewState {
    const mode = viewConfig?.viewType || "table";
    const modeState = viewConfig?.viewStates?.[mode];
    // BF-020: Prefer mode-specific snapshot, fall back to top-level
    const persisted = modeState ?? viewConfig;
    const sortRules = this.copySortRules(persisted?.sortRules);
    const legacySortColumn = persisted?.sortColumn;
    if (sortRules.length === 0 && legacySortColumn) {
      sortRules.push({
        field: legacySortColumn,
        direction: persisted?.sortDirection ?? "asc",
      });
    }
    return {
      searchText: persisted?.searchText ?? "",
      statusFilter: persisted?.statusFilter ?? "",
      groupByField: persisted?.groupByField ?? "",
      filters: this.copyFilters(persisted?.filters),
      hiddenColumns: new Set(persisted?.hiddenColumns ?? []),
      filterLogic: persisted?.filterLogic ?? "and",
      sortColumn: sortRules.length > 0 ? undefined : legacySortColumn,
      sortDirection: sortRules.length > 0 ? "asc" : persisted?.sortDirection ?? "asc",
      sortRules,
    };
  }

  private toPersistedState(state: DatabaseViewState): ViewModeStateDef {
    const hiddenColumns = Array.from(state.hiddenColumns);
    return {
      hiddenColumns: hiddenColumns.length > 0 ? hiddenColumns : undefined,
      statusFilter: state.statusFilter || undefined,
      searchText: state.searchText || undefined,
      groupByField: state.groupByField || undefined,
      filterLogic: state.filterLogic === "or" ? "or" : undefined,
      filters: state.filters.length > 0 ? this.copyFilters(state.filters) : undefined,
      sortColumn: state.sortColumn || undefined,
      sortDirection: state.sortColumn ? state.sortDirection : undefined,
      sortRules: state.sortRules.length > 0 ? this.copySortRules(state.sortRules) : undefined,
    };
  }

  private copyFilters(filters: FilterRule[] | undefined): FilterRule[] {
    return filters ? filters.map((f) => ({ ...f })) : [];
  }

  private copySortRules(rules: SortRule[] | undefined): SortRule[] {
    return rules ? rules.map((r) => ({ ...r })) : [];
  }
}

// ---- Helpers ----
function makeSchema(keys: string[]): { columns: ColumnDef[] } {
  return { columns: keys.map(k => ({ key: k, label: k, type: "text" })) };
}

function makeViewConfig(overrides: Partial<ViewConfig> = {}): ViewConfig {
  return {
    viewType: "table",
    schema: makeSchema(["col_a", "col_b"]),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("ViewStateStore", () => {
  let store: ViewStateStore;

  beforeEach(() => {
    store = new ViewStateStore();
  });

  describe("basic operations", () => {
    it("creates state with defaults when no config", () => {
      const state = store.get(0, 0);
      expect(state.searchText).toBe("");
      expect(state.filters).toEqual([]);
      expect(state.sortRules).toEqual([]);
      expect(state.hiddenColumns.size).toBe(0);
    });

    it("returns same state object for same key", () => {
      const s1 = store.get(0, 0);
      const s2 = store.get(0, 0);
      expect(s1).toBe(s2);
    });

    it("returns different states for different keys", () => {
      const s1 = store.get(0, 0);
      const s2 = store.get(0, 1);
      expect(s1).not.toBe(s2);
    });

    it("clear removes all states", () => {
      store.get(0, 0);
      store.get(0, 1);
      store.clear();
      // After clear, new states should be created
      const s1 = store.get(0, 0);
      expect(s1.searchText).toBe("");
    });
  });

  describe("BF-020: mode-specific state restoration", () => {
    it("reads from viewStates[viewType] when available", () => {
      const config = makeViewConfig({
        viewType: "board",
        viewStates: {
          board: {
            searchText: "board-search",
            filters: [{ field: "col_a", op: "eq", value: "x" }],
          },
          table: {
            searchText: "table-search",
          },
        },
        searchText: "legacy-search", // top-level fallback
      });
      const state = store.get(0, 0, config);
      expect(state.searchText).toBe("board-search");
    });

    it("falls back to top-level when viewType snapshot missing", () => {
      const config = makeViewConfig({
        viewType: "gallery",
        // No gallery snapshot
        searchText: "legacy",
        filters: [{ field: "col_a", op: "eq", value: "x" }],
      });
      const state = store.get(0, 0, config);
      expect(state.searchText).toBe("legacy");
    });

    it("falls back to top-level when viewStates undefined", () => {
      const config = makeViewConfig({
        viewType: "list",
        searchText: "top-level",
      });
      const state = store.get(0, 0, config);
      expect(state.searchText).toBe("top-level");
    });

    it("correctly converts legacy sortColumn to sortRules", () => {
      const config = makeViewConfig({
        sortColumn: "col_a",
        sortDirection: "desc",
      });
      const state = store.get(0, 0, config);
      expect(state.sortRules).toHaveLength(1);
      expect(state.sortRules[0].field).toBe("col_a");
      expect(state.sortRules[0].direction).toBe("desc");
    });
  });

  describe("BF-035: prune invalid restored state fields", () => {
    it("removes hidden columns for deleted schema fields", () => {
      const config = makeViewConfig({
        hiddenColumns: ["col_a", "deleted_col", "file.name"],
        schema: makeSchema(["col_a", "col_b"]),
      });
      const state = store.get(0, 0, config);
      expect(state.hiddenColumns.has("col_a")).toBe(true);
      expect(state.hiddenColumns.has("deleted_col")).toBe(false);
      // file.name is valid (built-in)
      expect(state.hiddenColumns.has("file.name")).toBe(true);
    });

    it("removes invalid filters", () => {
      const config = makeViewConfig({
        filters: [
          { field: "col_a", op: "eq", value: "x" },
          { field: "deleted", op: "neq", value: "y" },
        ],
        schema: makeSchema(["col_a", "col_b"]),
      });
      const state = store.get(0, 0, config);
      expect(state.filters).toHaveLength(1);
      expect(state.filters[0].field).toBe("col_a");
    });

    it("removes invalid sortRules", () => {
      const config = makeViewConfig({
        sortRules: [
          { field: "deleted", direction: "asc" },
          { field: "col_b", direction: "desc" },
        ],
        schema: makeSchema(["col_a", "col_b"]),
      });
      const state = store.get(0, 0, config);
      expect(state.sortRules).toHaveLength(1);
      expect(state.sortRules[0].field).toBe("col_b");
    });

    it("clears invalid sortColumn", () => {
      const config = makeViewConfig({
        sortColumn: "deleted",
        schema: makeSchema(["col_a"]),
      });
      const state = store.get(0, 0, config);
      expect(state.sortColumn).toBeUndefined();
      expect(state.sortDirection).toBe("asc");
    });

    it("clears invalid groupByField", () => {
      const config = makeViewConfig({
        groupByField: "deleted",
        schema: makeSchema(["col_a"]),
      });
      const state = store.get(0, 0, config);
      expect(state.groupByField).toBe("");
    });

    it("keeps file.name filters (built-in field)", () => {
      const config = makeViewConfig({
        filters: [
          { field: "file.name", op: "contains", value: "test" },
        ],
        schema: makeSchema(["col_a"]),
      });
      const state = store.get(0, 0, config);
      expect(state.filters).toHaveLength(1);
    });
  });

  describe("persist", () => {
    it("writes state to viewConfig under current viewType", () => {
      const config = makeViewConfig({ viewType: "table" });
      const state = store.get(0, 0, config);
      state.searchText = "hello";
      state.filters = [{ field: "col_a", op: "eq", value: "v" }];
      state.hiddenColumns.add("col_b");

      store.persist(config, state);

      expect(config.viewStates?.table?.searchText).toBe("hello");
      expect(config.viewStates?.table?.filters).toHaveLength(1);
      expect(config.viewStates?.table?.hiddenColumns).toContain("col_b");
    });

    it("also writes to top-level legacy fields", () => {
      const config = makeViewConfig({ viewType: "table" });
      const state = store.get(0, 0, config);
      state.searchText = "legacy-test";
      state.groupByField = "col_a";

      store.persist(config, state);

      expect(config.searchText).toBe("legacy-test");
      expect(config.groupByField).toBe("col_a");
    });

    it("does not persist empty arrays as non-undefined", () => {
      const config = makeViewConfig({ viewType: "table" });
      const state = store.get(0, 0, config);
      // Empty filters, hiddenColumns etc should be undefined in persisted form
      store.persist(config, state);
      expect(config.viewStates?.table?.filters).toBeUndefined();
      expect(config.viewStates?.table?.hiddenColumns).toBeUndefined();
    });
  });
});
