import { FilterRule, SortRule, ViewConfig } from "../data/types";

const BUILTIN_VIEW_FIELDS = new Set([
  "file.name",
  "file.path",
  "file.folder",
  "file.ext",
  "file.extension",
  "file.ctime",
  "file.created",
  "file.mtime",
  "file.modified",
  "file.size",
]);

export interface DatabaseViewState {
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

export class ViewStateStore {
  private states = new Map<string, DatabaseViewState>();

  /** Get or create state for a specific view within a database */
  get(dbIndex: number, viewIndex: number, viewConfig?: ViewConfig): DatabaseViewState {
    const key = this.getKey(dbIndex, viewIndex);
    let state = this.states.get(key);
    if (!state) {
      state = this.create(viewConfig);
      this.states.set(key, state);
    }
    // Prune hidden columns that no longer exist in current schema
    if (state && viewConfig) {
      const validKeys = new Set(viewConfig.schema.columns.map(c => c.key));
      for (const key of BUILTIN_VIEW_FIELDS) validKeys.add(key);
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

  /** Remove all cached states */
  clear(): void {
    this.states.clear();
  }

  /** Remove cached state for a specific database+view */
  delete(dbIndex: number, viewIndex: number): void {
    this.states.delete(this.getKey(dbIndex, viewIndex));
  }

  persist(viewConfig: ViewConfig, state: DatabaseViewState): void {
    const persisted = this.toPersistedState(state);
    viewConfig.viewStates = { ...(viewConfig.viewStates || {}) };
    // Store under current viewType key for backwards compat
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

  private create(viewConfig: ViewConfig | undefined): DatabaseViewState {
    const mode = viewConfig?.viewType || "table";
    const modeState = viewConfig?.viewStates?.[mode];
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

  private toPersistedState(state: DatabaseViewState): import("../data/types").ViewModeStateDef {
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
    return filters ? filters.map((filter) => ({ ...filter })) : [];
  }

  private copySortRules(rules: SortRule[] | undefined): SortRule[] {
    return rules ? rules.map((rule) => ({ ...rule })) : [];
  }

  private getKey(dbIndex: number, viewIndex: number): string {
    return `${dbIndex}:${viewIndex}`;
  }
}
