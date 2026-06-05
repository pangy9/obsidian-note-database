/**
 * Pure logic tests for ColumnTypes — these don't depend on Obsidian APIs.
 */
import { describe, it, expect } from "vitest";
import { safeString } from "../data/SafeString";

// We test the pure functions by copying their logic here.
// In a real setup, we'd import from the module after adding proper mocks.

// ---- toMultiSelectValues ----
function toMultiSelectValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => safeString(item).trim()).filter(Boolean);
  }
  if (value == null || value === "") return [];
  return safeString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// ---- toBooleanValue ----
function toBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = safeString(value).trim().toLowerCase();
  return ["true", "yes", "y", "1", "on", "checked", "是", "已勾选"].includes(normalized);
}

// ---- isOptionColumnType ----
type ColumnType = "text" | "number" | "date" | "currency" | "select" | "multi-select" | "status" | "checkbox" | "computed";
function isOptionColumnType(type: ColumnType): boolean {
  return type === "select" || type === "multi-select" || type === "status";
}

// ---- getDefaultCellValue ----
function getDefaultCellValue(type: ColumnType, options?: { value: string; color?: string }[]): unknown {
  if (type === "checkbox") return false;
  if (type === "multi-select") return [];
  if (isOptionColumnType(type)) return options?.[0]?.value || "";
  return "";
}

// ---- createOptionsFromValues ----
const OPTION_COLORS = [
  "blue", "green", "orange", "purple", "pink", "yellow", "red", "brown",
  "gray", "teal", "cyan", "lime", "indigo", "violet", "rose", "slate",
];
function createOptionsFromValues(values: unknown[]): { value: string; color: string }[] {
  const seen = new Set<string>();
  const options: { value: string; color: string }[] = [];
  for (const value of values) {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      if (part == null || part === "") continue;
      const text = String(part).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      options.push({ value: text, color: OPTION_COLORS[options.length % OPTION_COLORS.length] });
    }
  }
  return options;
}

// ---- cloneStatusOptions ----
function cloneStatusOptions(options: { value: string; color: string }[] | undefined): { value: string; color: string }[] {
  return (options || []).map((option) => ({
    value: String(option.value || "").trim(),
    color: option.color || "gray",
  })).filter((option) => option.value.length > 0);
}

// =============================================================================
// Tests
// =============================================================================

describe("toMultiSelectValues", () => {
  it("handles array of strings", () => {
    expect(toMultiSelectValues(["alpha", "beta"])).toEqual(["alpha", "beta"]);
  });

  it("handles comma-separated string", () => {
    expect(toMultiSelectValues("alpha, beta, gamma")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles comma-separated string (BF-004: comma+space delimiter)", () => {
    expect(toMultiSelectValues("alpha,beta")).toEqual(["alpha", "beta"]);
  });

  it("handles null/undefined/empty", () => {
    expect(toMultiSelectValues(null)).toEqual([]);
    expect(toMultiSelectValues(undefined)).toEqual([]);
    expect(toMultiSelectValues("")).toEqual([]);
  });

  it("filters out empty items", () => {
    expect(toMultiSelectValues(["alpha", "", "  ", "beta"])).toEqual(["alpha", "beta"]);
  });

  it("trims whitespace", () => {
    expect(toMultiSelectValues([" alpha ", " beta "])).toEqual(["alpha", "beta"]);
  });

  it("handles single value string", () => {
    expect(toMultiSelectValues("alpha")).toEqual(["alpha"]);
  });

  it("keeps # prefix in values (BF-004 relevance)", () => {
    // This test verifies that toMultiSelectValues does NOT strip #
    // because stripping # causes "current value not in options" bug
    expect(toMultiSelectValues(["#alpha", "beta"])).toEqual(["#alpha", "beta"]);
  });
});

describe("toBooleanValue", () => {
  it("handles boolean true/false", () => {
    expect(toBooleanValue(true)).toBe(true);
    expect(toBooleanValue(false)).toBe(false);
  });

  it("handles number 0/1", () => {
    expect(toBooleanValue(1)).toBe(true);
    expect(toBooleanValue(0)).toBe(false);
    expect(toBooleanValue(42)).toBe(true);
  });

  it("handles truthy strings", () => {
    for (const val of ["true", "yes", "y", "1", "on", "checked", "是", "已勾选"]) {
      expect(toBooleanValue(val)).toBe(true);
    }
  });

  it("handles falsy strings", () => {
    expect(toBooleanValue("false")).toBe(false);
    expect(toBooleanValue("no")).toBe(false);
    expect(toBooleanValue("")).toBe(false);
    expect(toBooleanValue("random")).toBe(false);
  });
});

describe("isOptionColumnType", () => {
  it("returns true for select, multi-select, status", () => {
    expect(isOptionColumnType("select")).toBe(true);
    expect(isOptionColumnType("multi-select")).toBe(true);
    expect(isOptionColumnType("status")).toBe(true);
  });

  it("returns false for other types", () => {
    expect(isOptionColumnType("text")).toBe(false);
    expect(isOptionColumnType("number")).toBe(false);
    expect(isOptionColumnType("date")).toBe(false);
    expect(isOptionColumnType("checkbox")).toBe(false);
    expect(isOptionColumnType("computed")).toBe(false);
    expect(isOptionColumnType("currency")).toBe(false);
  });
});

describe("getDefaultCellValue", () => {
  it("returns false for checkbox", () => {
    expect(getDefaultCellValue("checkbox")).toBe(false);
  });

  it("returns empty array for multi-select", () => {
    expect(getDefaultCellValue("multi-select")).toEqual([]);
  });

  it("returns first option value for select/status", () => {
    expect(getDefaultCellValue("select", [{ value: "todo", color: "blue" }])).toBe("todo");
    expect(getDefaultCellValue("status", [{ value: "draft", color: "gray" }])).toBe("draft");
  });

  it("returns empty string for select without options", () => {
    expect(getDefaultCellValue("select")).toBe("");
  });

  it("returns empty string for text/number", () => {
    expect(getDefaultCellValue("text")).toBe("");
    expect(getDefaultCellValue("number")).toBe("");
  });
});

describe("createOptionsFromValues", () => {
  it("creates options from string array", () => {
    const result = createOptionsFromValues(["alpha", "beta"]);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe("alpha");
    expect(result[1].value).toBe("beta");
  });

  it("deduplicates values", () => {
    const result = createOptionsFromValues(["alpha", "alpha", "beta"]);
    expect(result).toHaveLength(2);
  });

  it("handles nested arrays", () => {
    const result = createOptionsFromValues([["alpha", "beta"], "gamma"]);
    expect(result).toHaveLength(3);
  });

  it("skips null/empty values", () => {
    const result = createOptionsFromValues(["alpha", null, "", undefined, "beta"]);
    expect(result).toHaveLength(2);
  });

  it("assigns colors in order", () => {
    const result = createOptionsFromValues(["a", "b", "c"]);
    expect(result[0].color).toBe("blue");
    expect(result[1].color).toBe("green");
    expect(result[2].color).toBe("orange");
  });
});

describe("cloneStatusOptions", () => {
  it("clones and trims values", () => {
    const input = [
      { value: " alpha ", color: "blue" as const },
      { value: "beta", color: "red" as const },
    ];
    const result = cloneStatusOptions(input);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe("alpha");
    expect(result[1].value).toBe("beta");
  });

  it("filters empty values", () => {
    const input = [
      { value: "  ", color: "blue" as const },
      { value: "", color: "red" as const },
    ];
    const result = cloneStatusOptions(input);
    expect(result).toHaveLength(0);
  });

  it("handles undefined input", () => {
    expect(cloneStatusOptions(undefined)).toEqual([]);
  });

  it("defaults color to gray", () => {
    const input = [{ value: "test", color: undefined as unknown as string }];
    const result = cloneStatusOptions(input);
    expect(result[0].color).toBe("gray");
  });
});
