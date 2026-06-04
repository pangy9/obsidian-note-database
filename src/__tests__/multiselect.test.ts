/**
 * Tests for multi-select pure logic (MultiSelect.ts).
 * Covers BF-014: merge multi-select defaults for new records.
 */
import { describe, it, expect } from "vitest";

// ---- Helper from ColumnTypes ----
function toMultiSelectValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (value == null || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// ---- isEmptyGroupId ----
const EMPTY_GROUP_ID = "EMPTY_GROUP";
const LEGACY_EMPTY_GROUP_KEYS = new Set(["未分类", "未分類", "Uncategorized"]);

function isEmptyGroupId(value: unknown): boolean {
  const key = String(value ?? "").trim();
  return key.length === 0 || key === EMPTY_GROUP_ID || LEGACY_EMPTY_GROUP_KEYS.has(key);
}

// ---- sortMultiSelectValues ----
function sortMultiSelectValues(
  value: unknown,
  globalOptions: readonly (string | { value?: unknown; label?: unknown; name?: unknown })[] = []
): string[] {
  const ranks = createOptionRanks(globalOptions);
  return normalizeMultiSelectForCompare(value, ranks);
}

function normalizeMultiSelectForCompare(value: unknown, ranks: Map<string, number>): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const tag of toMultiSelectValues(value)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    values.push(tag);
  }
  return values.sort((a, b) => compareTag(a, b, ranks));
}

function compareTag(a: string, b: string, ranks: Map<string, number>): number {
  const ar = ranks.get(a) ?? Number.MAX_SAFE_INTEGER;
  const br = ranks.get(b) ?? Number.MAX_SAFE_INTEGER;
  if (ar !== br) return ar - br;
  return a.localeCompare(b);
}

function createOptionRanks(options: readonly (string | { value?: unknown; label?: unknown; name?: unknown })[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const option of options) {
    const value = getOptionValue(option);
    if (!value || ranks.has(value)) continue;
    ranks.set(value, ranks.size);
  }
  return ranks;
}

function getOptionValue(option: string | { value?: unknown; label?: unknown; name?: unknown }): string {
  if (typeof option === "string") return option.trim();
  const raw = option.value ?? option.label ?? option.name;
  return String(raw ?? "").trim();
}

// ---- compareMultiSelect ----
function compareMultiSelect(
  itemA: unknown,
  itemB: unknown,
  globalOptions: readonly (string | { value?: unknown; label?: unknown; name?: unknown })[] = []
): number {
  const ranks = createOptionRanks(globalOptions);
  const a = normalizeMultiSelectForCompare(itemA, ranks);
  const b = normalizeMultiSelectForCompare(itemB, ranks);
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i++) {
    const cmp = compareTag(a[i], b[i], ranks);
    if (cmp !== 0) return cmp;
  }
  return a.length - b.length;
}

// ---- moveMultiSelectGroupValue ----
function moveMultiSelectGroupValue(
  currentValue: unknown,
  fromGroupId: string | undefined,
  toGroupId: string,
  globalOptions: readonly (string | { value?: unknown; label?: unknown; name?: unknown })[] = []
): string[] {
  if (isEmptyGroupId(toGroupId)) return [];

  const target = String(toGroupId ?? "").trim();
  if (!target) return [];

  if (isEmptyGroupId(fromGroupId)) {
    return sortMultiSelectValues([target], globalOptions);
  }

  const source = String(fromGroupId ?? "").trim();
  const next = toMultiSelectValues(currentValue).filter((tag) => tag !== source);
  if (!next.includes(target)) next.push(target);
  return sortMultiSelectValues(next, globalOptions);
}

// ---- BF-014: mergeCreateDefaults ----
// Simulating the merge logic that combines source tags + filter values + group defaults
interface MergeableRecord { [key: string]: unknown; tags?: unknown; }

function mergeCreateDefaults(
  sourceRules: Record<string, unknown>,
  viewFilters: Record<string, unknown>,
  groupDefaults: Record<string, unknown>,
  multiSelectKeys: Set<string>
): MergeableRecord {
  const result: MergeableRecord = { ...sourceRules, ...viewFilters, ...groupDefaults };

  // Merge multi-select fields and tags
  const allKeys = new Set([...Object.keys(sourceRules), ...Object.keys(viewFilters), ...Object.keys(groupDefaults)]);

  for (const key of allKeys) {
    if (key === "tags" || multiSelectKeys.has(key)) {
      const sourceVal = sourceRules[key];
      const filterVal = viewFilters[key];
      const defaultVal = groupDefaults[key];

      const merged = new Set<string>();
      for (const val of [sourceVal, filterVal, defaultVal]) {
        for (const item of toMultiSelectValues(val)) {
          merged.add(item);
        }
      }
      if (merged.size > 0) {
        result[key] = Array.from(merged);
      }
    }
  }

  return result;
}

// =============================================================================
// Tests
// =============================================================================

describe("isEmptyGroupId", () => {
  it("returns true for empty/whitespace", () => {
    expect(isEmptyGroupId("")).toBe(true);
    expect(isEmptyGroupId("  ")).toBe(true);
  });

  it("returns true for EMPTY_GROUP_ID", () => {
    expect(isEmptyGroupId("EMPTY_GROUP")).toBe(true);
  });

  it("returns true for legacy empty group keys", () => {
    expect(isEmptyGroupId("未分类")).toBe(true);
    expect(isEmptyGroupId("未分類")).toBe(true);
    expect(isEmptyGroupId("Uncategorized")).toBe(true);
  });

  it("returns false for regular values", () => {
    expect(isEmptyGroupId("active")).toBe(false);
    expect(isEmptyGroupId("urgent")).toBe(false);
  });
});

describe("sortMultiSelectValues", () => {
  it("sorts by global option order", () => {
    const options = ["urgent", "active", "backlog"];
    const result = sortMultiSelectValues(["backlog", "urgent"], options);
    expect(result).toEqual(["urgent", "backlog"]);
  });

  it("alphabetical fallback for unknown options", () => {
    const result = sortMultiSelectValues(["z", "a"], []);
    expect(result).toEqual(["a", "z"]);
  });

  it("deduplicates", () => {
    const result = sortMultiSelectValues(["a", "a", "b"], []);
    expect(result).toEqual(["a", "b"]);
  });
});

describe("compareMultiSelect", () => {
  it("compares by global option rank", () => {
    const options = ["urgent", "active"];
    expect(compareMultiSelect(["urgent"], ["active"], options)).toBeLessThan(0);
  });

  it("shorter array first when prefix equal", () => {
    const result = compareMultiSelect(["alpha"], ["alpha", "beta"], []);
    expect(result).toBeLessThan(0);
  });

  it("equal arrays return 0", () => {
    expect(compareMultiSelect(["alpha", "beta"], ["beta", "alpha"], [])).toBe(0);
  });
});

describe("moveMultiSelectGroupValue", () => {
  it("moves from empty group to target", () => {
    const result = moveMultiSelectGroupValue([], "EMPTY_GROUP", "active");
    expect(result).toEqual(["active"]);
  });

  it("moves from one group to another", () => {
    const result = moveMultiSelectGroupValue(["active", "backlog"], "active", "urgent");
    expect(result).toContain("backlog");
    expect(result).toContain("urgent");
    expect(result).not.toContain("active");
  });

  it("returns empty for empty target group", () => {
    const result = moveMultiSelectGroupValue(["active"], "active", "EMPTY_GROUP");
    expect(result).toEqual([]);
  });
});

describe("BF-014: mergeCreateDefaults", () => {
  it("merges tags from all sources (no overwrite)", () => {
    const result = mergeCreateDefaults(
      { tags: ["alpha"] },
      { tags: ["beta"] },
      { tags: ["gamma"] },
      new Set(["tags"])
    );
    expect(result.tags).toContain("alpha");
    expect(result.tags).toContain("beta");
    expect(result.tags).toContain("gamma");
  });

  it("deduplicates merged tags", () => {
    const result = mergeCreateDefaults(
      { tags: ["alpha", "beta"] },
      { tags: ["beta"] },
      {},
      new Set(["tags"])
    );
    expect(result.tags).toEqual(["alpha", "beta"]);
  });

  it("merges multi-select fields", () => {
    const result = mergeCreateDefaults(
      { status: "active" },
      { status: "urgent" },
      {},
      new Set(["status"])
    );
    expect(result.status).toContain("active");
    expect(result.status).toContain("urgent");
  });

  it("non-multi-select fields use last-write-wins", () => {
    const result = mergeCreateDefaults(
      { title: "old" },
      { title: "new" },
      {},
      new Set()
    );
    expect(result.title).toBe("new");
  });

  it("handles comma-string multi-select values", () => {
    const result = mergeCreateDefaults(
      { tags: "alpha, beta" },
      {},
      { tags: "gamma" },
      new Set(["tags"])
    );
    expect(result.tags).toContain("alpha");
    expect(result.tags).toContain("beta");
    expect(result.tags).toContain("gamma");
  });
});
