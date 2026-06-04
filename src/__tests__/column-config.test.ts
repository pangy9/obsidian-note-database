/**
 * Tests for ColumnConfig pure logic.
 * Covers:
 * - BF-022: updateColumnKeyReferences traversing all views
 * - BF-027: removeColumnReferences covering sortColumnOrder
 * - ensureColumnOrder, normalizeColumnOrder, createUniqueColumnKey
 * - updateSourceRuleKeyReferences
 */
import { describe, it, expect } from "vitest";

// ---- Types (simplified for testing) ----
interface ColumnDef {
  key: string;
  label: string;
  type: string;
  computedKey?: string;
}

interface FilterRule {
  field: string;
  op: string;
  value?: string;
}

interface SortRule {
  field: string;
  direction: "asc" | "desc";
}

interface ViewModeStateDef {
  hiddenColumns?: string[];
  filters?: FilterRule[];
  sortRules?: SortRule[];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  groupByField?: string;
}

interface SourceRule {
  field: string;
  op: string;
  value?: string;
}

interface ViewConfig {
  columnOrder?: string[];
  hiddenColumns?: string[];
  filters?: FilterRule[];
  sortRules?: SortRule[];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  sortColumnOrder?: string;
  groupByField?: string;
  titleField?: string;
  galleryImageField?: string;
  boardGroupField?: string;
  boardSubgroupField?: string;
  sourceRules?: SourceRule[];
  groupOrders?: Record<string, string[]>;
  collapsedGroups?: Record<string, string[]>;
  boardCardOrders?: Record<string, Record<string, string[]>>;
  viewStates?: Partial<Record<string, ViewModeStateDef>>;
  schema: { columns: ColumnDef[]; computedFields: { key: string; label: string; expression: string; type: string }[] };
}

// ---- ensureColumnOrder ----
function ensureColumnOrder(config: ViewConfig): void {
  if (!config.columnOrder || config.columnOrder.length === 0) {
    config.columnOrder = config.schema.columns.map((col) => col.key);
    return;
  }
  normalizeColumnOrder(config);
}

// ---- normalizeColumnOrder ----
function normalizeColumnOrder(config: ViewConfig): void {
  if (!config.columnOrder) return;
  const validKeys = new Set(config.schema.columns.map((col) => col.key));
  const normalized = config.columnOrder.filter((key, index, arr) =>
    validKeys.has(key) && arr.indexOf(key) === index
  );
  for (const col of config.schema.columns) {
    if (!normalized.includes(col.key)) normalized.push(col.key);
  }
  config.columnOrder = normalized;
}

// ---- createUniqueColumnKey ----
function createUniqueColumnKey(config: ViewConfig, base: string): string {
  const keys = new Set(config.schema.columns.map((col) => col.key));
  if (!keys.has(base)) return base;
  let i = 1;
  let key = `${base}_${i}`;
  while (keys.has(key)) {
    i += 1;
    key = `${base}_${i}`;
  }
  return key;
}

// ---- updateSourceRuleKeyReferences ----
function updateSourceRuleKeyReferences(
  rules: SourceRule[] | undefined,
  oldKey: string,
  newKey: string
): boolean {
  let changed = false;
  for (const rule of rules || []) {
    if (rule.field !== oldKey) continue;
    rule.field = newKey;
    changed = true;
  }
  return changed;
}

// ---- removeColumnReferences (BF-022 + BF-027) ----
function removeColumnReferences(config: ViewConfig, key: string): void {
  ensureColumnOrder(config);
  config.columnOrder = (config.columnOrder || []).filter((candidate) => candidate !== key);
  config.hiddenColumns = (config.hiddenColumns || []).filter((candidate) => candidate !== key);
  config.filters = (config.filters || []).filter((rule) => rule.field !== key);
  config.sortRules = (config.sortRules || []).filter((rule) => rule.field !== key);
  if (config.sortColumn === key) {
    config.sortColumn = undefined;
    config.sortDirection = "asc";
  }
  // BF-027: also clean legacy sortColumnOrder
  if (config.sortColumnOrder === key) config.sortColumnOrder = undefined;
  if (config.groupByField === key) config.groupByField = undefined;
  if (config.titleField === key) config.titleField = undefined;
  if (config.galleryImageField === key) config.galleryImageField = undefined;
  if (config.boardGroupField === key) config.boardGroupField = undefined;
  if (config.boardSubgroupField === key) config.boardSubgroupField = undefined;
  removeSourceRuleReferences(config.sourceRules, key);
  delete config.groupOrders?.[key];
  delete config.collapsedGroups?.[key];
  delete config.boardCardOrders?.[key];
  // Also clean viewStates
  for (const viewState of Object.values(config.viewStates || {})) {
    if (!viewState) continue;
    viewState.hiddenColumns = (viewState.hiddenColumns || []).filter((candidate) => candidate !== key);
    viewState.filters = (viewState.filters || []).filter((rule) => rule.field !== key);
    viewState.sortRules = (viewState.sortRules || []).filter((rule) => rule.field !== key);
    if (viewState.sortColumn === key) {
      viewState.sortColumn = undefined;
      viewState.sortDirection = "asc";
    }
    if (viewState.groupByField === key) viewState.groupByField = undefined;
  }
}

function removeSourceRuleReferences(rules: SourceRule[] | undefined, key: string): void {
  if (!rules) return;
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    if (rules[index].field === key) rules.splice(index, 1);
  }
}

// ---- updateColumnKeyReferences (BF-022: simplified) ----
function updateColumnKeyReferences(
  config: ViewConfig,
  oldKey: string,
  newKey: string
): boolean {
  if (oldKey === newKey) return false;
  let changed = false;

  const replaceValue = (value: string | undefined): string | undefined => {
    if (value !== oldKey) return value;
    changed = true;
    return newKey;
  };

  const replaceKeys = (keys: string[] | undefined): string[] | undefined => {
    if (!keys?.includes(oldKey)) return keys;
    changed = true;
    return keys.map((key) => key === oldKey ? newKey : key);
  };

  config.columnOrder = replaceKeys(config.columnOrder);
  config.titleField = replaceValue(config.titleField);
  config.galleryImageField = replaceValue(config.galleryImageField);
  config.boardGroupField = replaceValue(config.boardGroupField);
  config.boardSubgroupField = replaceValue(config.boardSubgroupField);
  config.groupByField = replaceValue(config.groupByField);
  config.sortColumn = replaceValue(config.sortColumn);
  config.sortColumnOrder = replaceValue(config.sortColumnOrder);
  changed = updateSourceRuleKeyReferences(config.sourceRules, oldKey, newKey) || changed;

  for (const rule of config.filters || []) {
    if (rule.field === oldKey) { rule.field = newKey; changed = true; }
  }
  for (const rule of config.sortRules || []) {
    if (rule.field === oldKey) { rule.field = newKey; changed = true; }
  }

  config.hiddenColumns = replaceKeys(config.hiddenColumns);
  if (config.groupOrders?.[oldKey]) {
    config.groupOrders[newKey] = config.groupOrders[oldKey];
    delete config.groupOrders[oldKey];
    changed = true;
  }
  if (config.collapsedGroups?.[oldKey]) {
    config.collapsedGroups[newKey] = config.collapsedGroups[oldKey];
    delete config.collapsedGroups[oldKey];
    changed = true;
  }
  if (config.boardCardOrders?.[oldKey]) {
    config.boardCardOrders[newKey] = config.boardCardOrders[oldKey];
    delete config.boardCardOrders[oldKey];
    changed = true;
  }

  for (const viewState of Object.values(config.viewStates || {})) {
    if (!viewState) continue;
    viewState.sortColumn = replaceValue(viewState.sortColumn);
    viewState.groupByField = replaceValue(viewState.groupByField);
    viewState.hiddenColumns = replaceKeys(viewState.hiddenColumns);
    for (const rule of viewState.sortRules || []) {
      if (rule.field === oldKey) { rule.field = newKey; changed = true; }
    }
    for (const rule of viewState.filters || []) {
      if (rule.field === oldKey) { rule.field = newKey; changed = true; }
    }
  }
  return changed;
}

// ---- Helpers ----
function makeViewConfig(overrides: Partial<ViewConfig> = {}): ViewConfig {
  return {
    schema: { columns: [], computedFields: [] },
    ...overrides,
  } as ViewConfig;
}

// =============================================================================
// Tests
// =============================================================================

describe("ensureColumnOrder", () => {
  it("creates columnOrder from schema if empty", () => {
    const config = makeViewConfig({
      schema: {
        columns: [{ key: "a", label: "A", type: "text" }, { key: "b", label: "B", type: "text" }],
        computedFields: [],
      },
    });
    ensureColumnOrder(config);
    expect(config.columnOrder).toEqual(["a", "b"]);
  });

  it("creates columnOrder from schema if undefined", () => {
    const config = makeViewConfig({
      schema: {
        columns: [{ key: "x", label: "X", type: "text" }],
        computedFields: [],
      },
    });
    ensureColumnOrder(config);
    expect(config.columnOrder).toEqual(["x"]);
  });

  it("normalizes existing columnOrder", () => {
    const config = makeViewConfig({
      columnOrder: ["b", "stale", "a"],
      schema: {
        columns: [
          { key: "a", label: "A", type: "text" },
          { key: "b", label: "B", type: "text" },
        ],
        computedFields: [],
      },
    });
    ensureColumnOrder(config);
    expect(config.columnOrder).toEqual(["b", "a"]); // stale removed, no new cols to add
  });
});

describe("normalizeColumnOrder", () => {
  it("removes stale keys and deduplicates", () => {
    const config = makeViewConfig({
      columnOrder: ["a", "stale", "a", "b"],
      schema: {
        columns: [
          { key: "a", label: "A", type: "text" },
          { key: "b", label: "B", type: "text" },
        ],
        computedFields: [],
      },
    });
    normalizeColumnOrder(config);
    expect(config.columnOrder).toEqual(["a", "b"]);
  });

  it("appends new columns at end", () => {
    const config = makeViewConfig({
      columnOrder: ["a"],
      schema: {
        columns: [
          { key: "a", label: "A", type: "text" },
          { key: "b", label: "B", type: "text" },
          { key: "c", label: "C", type: "text" },
        ],
        computedFields: [],
      },
    });
    normalizeColumnOrder(config);
    expect(config.columnOrder).toEqual(["a", "b", "c"]);
  });
});

describe("createUniqueColumnKey", () => {
  it("returns base if not taken", () => {
    const config = makeViewConfig({
      schema: {
        columns: [{ key: "existing", label: "E", type: "text" }],
        computedFields: [],
      },
    });
    expect(createUniqueColumnKey(config, "new_field")).toBe("new_field");
  });

  it("appends suffix if taken", () => {
    const config = makeViewConfig({
      schema: {
        columns: [{ key: "new_field", label: "N", type: "text" }],
        computedFields: [],
      },
    });
    expect(createUniqueColumnKey(config, "new_field")).toBe("new_field_1");
  });

  it("increments suffix until unique", () => {
    const config = makeViewConfig({
      schema: {
        columns: [
          { key: "new_field", label: "N", type: "text" },
          { key: "new_field_1", label: "N1", type: "text" },
        ],
        computedFields: [],
      },
    });
    expect(createUniqueColumnKey(config, "new_field")).toBe("new_field_2");
  });
});

describe("updateSourceRuleKeyReferences", () => {
  it("replaces field in source rules", () => {
    const rules: SourceRule[] = [
      { field: "old_status", op: "eq", value: "active" },
      { field: "other", op: "neq", value: "x" },
    ];
    updateSourceRuleKeyReferences(rules, "old_status", "new_status");
    expect(rules[0].field).toBe("new_status");
    expect(rules[1].field).toBe("other");
  });

  it("returns true when changes were made", () => {
    const rules: SourceRule[] = [{ field: "old", op: "eq", value: "v" }];
    expect(updateSourceRuleKeyReferences(rules, "old", "new")).toBe(true);
  });

  it("returns false when no changes", () => {
    const rules: SourceRule[] = [{ field: "other", op: "eq", value: "v" }];
    expect(updateSourceRuleKeyReferences(rules, "old", "new")).toBe(false);
  });

  it("handles undefined rules", () => {
    expect(updateSourceRuleKeyReferences(undefined, "old", "new")).toBe(false);
  });
});

describe("BF-022: updateColumnKeyReferences traverses all references", () => {
  it("migrates filter references", () => {
    const config = makeViewConfig({
      filters: [
        { field: "old", op: "eq", value: "x" },
        { field: "other", op: "neq", value: "y" },
      ],
    });
    updateColumnKeyReferences(config, "old", "new");
    expect(config.filters![0].field).toBe("new");
    expect(config.filters![1].field).toBe("other");
  });

  it("migrates sortRule references", () => {
    const config = makeViewConfig({
      sortRules: [{ field: "old", direction: "asc" }],
    });
    updateColumnKeyReferences(config, "old", "new");
    expect(config.sortRules![0].field).toBe("new");
  });

  it("migrates sortColumn and sortColumnOrder", () => {
    const config = makeViewConfig({
      sortColumn: "old",
      sortColumnOrder: "old",
    });
    updateColumnKeyReferences(config, "old", "new");
    expect(config.sortColumn).toBe("new");
    expect(config.sortColumnOrder).toBe("new");
  });

  it("migrates groupByField, galleryImageField, boardGroupField, titleField", () => {
    const config = makeViewConfig({
      groupByField: "old",
      galleryImageField: "old",
      boardGroupField: "old",
      titleField: "old",
    });
    updateColumnKeyReferences(config, "old", "new");
    expect(config.groupByField).toBe("new");
    expect(config.galleryImageField).toBe("new");
    expect(config.boardGroupField).toBe("new");
    expect(config.titleField).toBe("new");
  });

  it("migrates sourceRule references", () => {
    const config = makeViewConfig({
      sourceRules: [{ field: "old", op: "eq", value: "v" }],
    });
    updateColumnKeyReferences(config, "old", "new");
    expect(config.sourceRules![0].field).toBe("new");
  });

  it("migrates viewState references", () => {
    const config = makeViewConfig({
      viewStates: {
        table: {
          filters: [{ field: "old", op: "eq", value: "v" }],
          sortRules: [{ field: "old", direction: "asc" }],
          sortColumn: "old",
          groupByField: "old",
          hiddenColumns: ["old"],
        },
      },
    });
    updateColumnKeyReferences(config, "old", "new");
    const vs = config.viewStates!.table!;
    expect(vs.filters![0].field).toBe("new");
    expect(vs.sortRules![0].field).toBe("new");
    expect(vs.sortColumn).toBe("new");
    expect(vs.groupByField).toBe("new");
    expect(vs.hiddenColumns).toEqual(["new"]);
  });

  it("migrates groupOrders and collapsedGroups keys", () => {
    const config = makeViewConfig({
      groupOrders: { old: ["a", "b"] },
      collapsedGroups: { old: ["g1"] },
    });
    updateColumnKeyReferences(config, "old", "new");
    expect(config.groupOrders!["old"]).toBeUndefined();
    expect(config.groupOrders!["new"]).toEqual(["a", "b"]);
    expect(config.collapsedGroups!["old"]).toBeUndefined();
    expect(config.collapsedGroups!["new"]).toEqual(["g1"]);
  });

  it("returns false when oldKey equals newKey", () => {
    const config = makeViewConfig();
    expect(updateColumnKeyReferences(config, "same", "same")).toBe(false);
  });
});

describe("BF-027: removeColumnReferences cleans sortColumnOrder", () => {
  it("clears sortColumnOrder when removing referenced property", () => {
    const config = makeViewConfig({
      columnOrder: ["status", "other"],
      sortColumnOrder: "status",
      schema: {
        columns: [
          { key: "status", label: "Status", type: "status" },
          { key: "other", label: "Other", type: "text" },
        ],
        computedFields: [],
      },
    });
    removeColumnReferences(config, "status");
    expect(config.sortColumnOrder).toBeUndefined();
    expect(config.columnOrder).not.toContain("status");
  });

  it("does not clear sortColumnOrder for unrelated property", () => {
    const config = makeViewConfig({
      columnOrder: ["status", "other"],
      sortColumnOrder: "status",
      schema: {
        columns: [
          { key: "status", label: "Status", type: "status" },
          { key: "other", label: "Other", type: "text" },
        ],
        computedFields: [],
      },
    });
    removeColumnReferences(config, "other");
    expect(config.sortColumnOrder).toBe("status");
  });

  it("cleans sourceRule references for deleted property", () => {
    const config = makeViewConfig({
      sourceRules: [
        { field: "deleted_key", op: "eq", value: "v" },
        { field: "keep", op: "neq", value: "x" },
      ],
      schema: {
        columns: [],
        computedFields: [],
      },
    });
    removeColumnReferences(config, "deleted_key");
    expect(config.sourceRules).toHaveLength(1);
    expect(config.sourceRules![0].field).toBe("keep");
  });
});
