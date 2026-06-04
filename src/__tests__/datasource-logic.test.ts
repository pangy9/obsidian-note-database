/**
 * Tests for pure logic extracted from DataSource and FrontmatterScanner.
 * - normalizeVaultFolder: path normalization
 * - getTags: tag parsing/normalization
 * - Source rule matching operators
 */
import { describe, it, expect } from "vitest";

// ---- normalizeVaultFolder (duplicated in 3 files, identical logic) ----
function normalizeVaultFolder(folderPath: string): string {
  const normalized = (folderPath || "").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+/g, "/");
  if (normalized === "/") return "";
  return normalized;
}

// More accurate version matching Obsidian's normalizePath + strip logic
function normalizeVaultFolderObsidian(folderPath: string): string {
  // Simulates: normalizePath(folderPath || "") then strip leading /
  // normalizePath removes trailing slashes, collapses double slashes
  let normalized = (folderPath || "").trim();
  // Collapse multiple slashes
  normalized = normalized.replace(/\/+/g, "/");
  // Remove trailing slash
  normalized = normalized.replace(/\/+$/, "");
  // Remove leading slash AFTER normalizePath would have cleaned it
  // But normalizePath on "/Projects" returns "/Projects" (keeps leading /)
  // Then we strip leading /
  if (normalized === "/") return "";
  return normalized.replace(/^\/+/, "");
}

// ---- getTags (tag parsing from frontmatter) ----
function getTags(fm: Record<string, unknown>): string[] {
  const raw = fm["tags"] ?? fm["tag"];
  if (Array.isArray(raw)) return raw.map((tag) => String(tag).replace(/^#/, ""));
  if (typeof raw === "string") return raw.split(/[,\s]+/).filter(Boolean).map((tag) => tag.replace(/^#/, ""));
  return [];
}

// ---- Source rule operator matching (pure logic, no Obsidian deps) ----
type SourceRuleOp = "inFolder" | "hasTag" | "eq" | "neq" | "contains" | "empty" | "notempty";

interface SourceRule {
  field: string;
  op: SourceRuleOp;
  value?: string;
}

function matchOperator(value: unknown, op: SourceRuleOp, expected: string): boolean {
  switch (op) {
    case "eq":
      return String(value ?? "") === expected;
    case "neq":
      return String(value ?? "") !== expected;
    case "contains":
      return String(value ?? "").toLowerCase().includes(expected.toLowerCase());
    case "empty":
      return value == null || value === "";
    case "notempty":
      return value != null && value !== "";
    default:
      return true;
  }
}

// ---- getEffectiveSourceRules ----
function getEffectiveSourceRules(
  sourceFolder: string,
  rules: { op: SourceRuleOp; field: string; value?: string }[] | undefined
): { op: SourceRuleOp; field: string; value?: string }[] {
  const folder = normalizeVaultFolderObsidian(sourceFolder);
  if (!folder) return rules || [];
  return (rules || []).filter((rule) =>
    rule.op !== "inFolder" ||
    normalizeVaultFolderObsidian(String(rule.value ?? "")) !== folder
  );
}

// ---- matchesRules logic (AND/OR) ----
function evaluateRulesLogic(
  results: boolean[],
  logic: "and" | "or"
): boolean {
  if (results.length === 0) return true;
  return logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

// =============================================================================
// Tests
// =============================================================================

describe("normalizeVaultFolder", () => {
  it("normalizes /Projects to Projects", () => {
    expect(normalizeVaultFolderObsidian("/Projects")).toBe("Projects");
  });

  it("keeps Projects unchanged", () => {
    expect(normalizeVaultFolderObsidian("Projects")).toBe("Projects");
  });

  it("normalizes root / to empty string", () => {
    expect(normalizeVaultFolderObsidian("/")).toBe("");
  });

  it("normalizes empty string to empty string", () => {
    expect(normalizeVaultFolderObsidian("")).toBe("");
  });

  it("handles path with multiple segments", () => {
    expect(normalizeVaultFolderObsidian("/Projects/Active")).toBe("Projects/Active");
  });

  it("removes trailing slash", () => {
    expect(normalizeVaultFolderObsidian("Projects/")).toBe("Projects");
    expect(normalizeVaultFolderObsidian("/Projects/")).toBe("Projects");
  });

  it("BF-005: ensures /Projects and Projects produce same result", () => {
    const result1 = normalizeVaultFolderObsidian("/Projects");
    const result2 = normalizeVaultFolderObsidian("Projects");
    expect(result1).toBe(result2);
  });
});

describe("getTags", () => {
  it("parses array tags, stripping # prefix", () => {
    const tags = getTags({ tags: ["#alpha", "#beta"] });
    expect(tags).toEqual(["alpha", "beta"]);
  });

  it("parses string tags split by comma", () => {
    const tags = getTags({ tags: "alpha, beta, gamma" });
    expect(tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("BF-004: parses string tags split by whitespace (old regex bug was /[,\\s]+/)", () => {
    const tags = getTags({ tags: "alpha beta gamma" });
    expect(tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("BF-004: correctly uses comma+whitespace delimiter", () => {
    // The old regex /[,\\s]+/ was wrong (\\s matches literal \ and s, not whitespace)
    // The fix uses /[,\\s]+/ in a regex literal → /[,\s]+/ which correctly matches commas and whitespace
    const tags = getTags({ tags: "alpha, beta gamma, delta" });
    expect(tags).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("falls back to tag field", () => {
    const tags = getTags({ tag: ["alpha"] });
    expect(tags).toEqual(["alpha"]);
  });

  it("returns empty for missing tags", () => {
    expect(getTags({})).toEqual([]);
  });

  it("handles non-string/non-array tags gracefully", () => {
    expect(getTags({ tags: 123 })).toEqual([]);
  });
});

describe("matchOperator", () => {
  describe("eq", () => {
    it("matches equal values", () => {
      expect(matchOperator("alpha", "eq", "alpha")).toBe(true);
    });
    it("rejects different values", () => {
      expect(matchOperator("alpha", "eq", "beta")).toBe(false);
    });
    it("handles null as empty string", () => {
      expect(matchOperator(null, "eq", "")).toBe(true);
    });
  });

  describe("neq", () => {
    it("rejects equal values", () => {
      expect(matchOperator("alpha", "neq", "alpha")).toBe(false);
    });
    it("matches different values", () => {
      expect(matchOperator("alpha", "neq", "beta")).toBe(true);
    });
  });

  describe("contains", () => {
    it("matches substring (case insensitive)", () => {
      expect(matchOperator("Hello World", "contains", "world")).toBe(true);
    });
    it("rejects non-matching substrings", () => {
      expect(matchOperator("Hello", "contains", "xyz")).toBe(false);
    });
  });

  describe("empty", () => {
    it("matches null", () => expect(matchOperator(null, "empty", "")).toBe(true));
    it("matches undefined", () => expect(matchOperator(undefined, "empty", "")).toBe(true));
    it("matches empty string", () => expect(matchOperator("", "empty", "")).toBe(true));
    it("rejects non-empty", () => expect(matchOperator("value", "empty", "")).toBe(false));
    it("rejects zero (0 is not empty)", () => {
      expect(matchOperator(0, "empty", "")).toBe(false);
    });
  });

  describe("notempty", () => {
    it("matches non-null values", () => expect(matchOperator("value", "notempty", "")).toBe(true));
    it("matches zero", () => expect(matchOperator(0, "notempty", "")).toBe(true));
    it("rejects null", () => expect(matchOperator(null, "notempty", "")).toBe(false));
    it("rejects empty string", () => expect(matchOperator("", "notempty", "")).toBe(false));
  });
});

describe("getEffectiveSourceRules", () => {
  it("BF-001: removes only duplicate inFolder rule, keeps narrower ones", () => {
    const rules = [
      { field: "file.path", op: "inFolder" as const, value: "Projects" },
      { field: "file.path", op: "inFolder" as const, value: "Projects/Active" },
      { field: "tags", op: "hasTag" as const, value: "#active" },
    ];
    const effective = getEffectiveSourceRules("Projects", rules);
    expect(effective).toHaveLength(2);
    expect(effective[0].value).toBe("Projects/Active");
    expect(effective[1].value).toBe("#active");
  });

  it("keeps all rules when no sourceFolder", () => {
    const rules = [
      { field: "file.path", op: "inFolder" as const, value: "Projects" },
    ];
    const effective = getEffectiveSourceRules("", rules);
    expect(effective).toHaveLength(1);
  });

  it("keeps non-inFolder rules", () => {
    const rules = [
      { field: "file.path", op: "inFolder" as const, value: "Projects" },
      { field: "tags", op: "hasTag" as const, value: "#active" },
    ];
    const effective = getEffectiveSourceRules("Projects", rules);
    expect(effective).toHaveLength(1);
    expect(effective[0].op).toBe("hasTag");
  });

  it("returns empty array when rules is undefined", () => {
    expect(getEffectiveSourceRules("Projects", undefined)).toEqual([]);
  });

  it("BF-005: matches /Projects with Projects", () => {
    const rules = [
      { field: "file.path", op: "inFolder" as const, value: "/Projects" },
      { field: "tags", op: "hasTag" as const, value: "#active" },
    ];
    const effective = getEffectiveSourceRules("Projects", rules);
    // /Projects normalizes to "Projects" same as sourceFolder
    expect(effective).toHaveLength(1);
    expect(effective[0].op).toBe("hasTag");
  });
});

describe("evaluateRulesLogic (AND/OR)", () => {
  it("OR returns true if any match", () => {
    expect(evaluateRulesLogic([false, false, true], "or")).toBe(true);
  });

  it("OR returns false if none match", () => {
    expect(evaluateRulesLogic([false, false, false], "or")).toBe(false);
  });

  it("AND returns true if all match", () => {
    expect(evaluateRulesLogic([true, true, true], "and")).toBe(true);
  });

  it("AND returns false if any fails", () => {
    expect(evaluateRulesLogic([true, false, true], "and")).toBe(false);
  });

  it("empty rules returns true (match all)", () => {
    expect(evaluateRulesLogic([], "and")).toBe(true);
    expect(evaluateRulesLogic([], "or")).toBe(true);
  });

  it("single rule OR works", () => {
    expect(evaluateRulesLogic([true], "or")).toBe(true);
    expect(evaluateRulesLogic([false], "or")).toBe(false);
  });
});
