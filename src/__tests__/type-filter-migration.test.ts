import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { absorbTypeFilterIntoRules, getRequiredSourceRules } from "../data/SourceRules";
import type { SourceRuleNode } from "../data/types";

vi.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
}));

// Legacy `typeFilter` — a special-case filter on the frontmatter `type` field
// that predates general source rules — is migrated into the source-rule tree as
// a leaf `{ field: "type", op: "eq", value }`. This preserves both of typeFilter's
// old jobs: filtering records (`eq` reproduces `frontmatter["type"] === x`) and
// seeding `type` on newly created records (`getRequiredSourceRules` returns the
// AND leaf, consumed by `getDefaultFrontmatterFromSourceRules`).
//
// Driven by `DataSource.getViewDefFiles` (in-memory, first scan correct) and
// `migrateTypeFilterToSourceRules` (persisted to disk via processFrontMatter).

describe("absorbTypeFilterIntoRules", () => {
  const host = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ ...overrides });

  it("folds a typeFilter into a single eq leaf when there is no existing tree", () => {
    const h = host({ typeFilter: "book" });
    expect(absorbTypeFilterIntoRules(h, h.typeFilter)).toBe(true);
    expect(h.sourceRuleTree).toEqual({ field: "type", op: "eq", value: "book" });
    expect(h.sourceRules).toBeUndefined();
    expect(h.sourceLogic).toBeUndefined();
    expect(h.typeFilter).toBeUndefined();
  });

  it("AND-merges the type leaf into an existing sourceRuleTree, preserving it", () => {
    const existing: SourceRuleNode = { field: "status", op: "eq", value: "active" };
    const h = host({ typeFilter: "book", sourceRuleTree: existing });
    absorbTypeFilterIntoRules(h, h.typeFilter);
    expect(h.sourceRuleTree).toEqual({
      type: "group",
      logic: "and",
      rules: [
        { field: "status", op: "eq", value: "active" },
        { field: "type", op: "eq", value: "book" },
      ],
    });
  });

  it("folds legacy flat sourceRules into the tree too (tree becomes single source of truth)", () => {
    const h = host({
      typeFilter: "book",
      sourceRules: [{ field: "status", op: "eq", value: "active" }],
      sourceLogic: "and",
    });
    absorbTypeFilterIntoRules(h, h.typeFilter);
    expect(h.sourceRules).toBeUndefined();
    expect(h.sourceLogic).toBeUndefined();
    expect(h.sourceRuleTree).toEqual({
      type: "group",
      logic: "and",
      rules: [
        { field: "status", op: "eq", value: "active" },
        { field: "type", op: "eq", value: "book" },
      ],
    });
  });

  it("is a no-op (returns false) for an empty / missing / blank typeFilter", () => {
    const h = host({ sourceRuleTree: { field: "status", op: "eq", value: "active" } });
    expect(absorbTypeFilterIntoRules(h, undefined)).toBe(false);
    expect(absorbTypeFilterIntoRules(h, "")).toBe(false);
    expect(absorbTypeFilterIntoRules(h, "   ")).toBe(false);
    // Tree untouched, nothing cleared.
    expect(h.sourceRuleTree).toEqual({ field: "status", op: "eq", value: "active" });
  });

  it("trims whitespace from the typeFilter value", () => {
    const h = host({ typeFilter: "  book  " });
    absorbTypeFilterIntoRules(h, h.typeFilter);
    expect(h.sourceRuleTree).toEqual({ field: "type", op: "eq", value: "book" });
  });

  it("migrates db-level and per-view hosts independently", () => {
    const db = host({ typeFilter: "book" });
    const view = host({ typeFilter: "note" });
    absorbTypeFilterIntoRules(db, db.typeFilter);
    absorbTypeFilterIntoRules(view, view.typeFilter);
    expect(db.sourceRuleTree).toEqual({ field: "type", op: "eq", value: "book" });
    expect(view.sourceRuleTree).toEqual({ field: "type", op: "eq", value: "note" });
  });

  it("dedupes an identical existing type rule instead of duplicating it", () => {
    const h = host({
      typeFilter: "book",
      sourceRuleTree: { field: "type", op: "eq", value: "book" },
    });
    absorbTypeFilterIntoRules(h, h.typeFilter);
    expect(h.sourceRuleTree).toEqual({ field: "type", op: "eq", value: "book" });
  });

  it("produced leaf is returned by getRequiredSourceRules (seeds new-record type)", () => {
    // Verifies the contract that makes new records keep getting `type` after the
    // migration: the eq leaf is a required AND leaf.
    const h = host({ typeFilter: "book" });
    absorbTypeFilterIntoRules(h, h.typeFilter);
    const required = getRequiredSourceRules(h.sourceRuleTree as SourceRuleNode);
    expect(required).toContainEqual({ field: "type", op: "eq", value: "book" });
  });
});

describe("typeFilter migration wiring (DataSource)", () => {
  const src = readFileSync(new URL("../data/DataSource.ts", import.meta.url), "utf8");

  it("getViewDefFiles absorbs typeFilter in-memory (db + views) and persists asynchronously", () => {
    expect(src).toContain("absorbTypeFilterIntoRules(config, databaseObj[\"typeFilter\"])");
    expect(src).toContain("absorbTypeFilterIntoRules(viewConfig, rawView[\"typeFilter\"])");
    expect(src).toContain("void this.migrateTypeFilterToSourceRules(typeFilterTargets)");
  });

  it("migrateTypeFilterToSourceRules absorbs db + per-view typeFilter on disk", () => {
    expect(src).toContain("private async migrateTypeFilterToSourceRules(");
    expect(src).toContain("absorbTypeFilterIntoRules(db, db[\"typeFilter\"])");
  });

  it("removes typeFilter from typed read / serialize / filter paths", () => {
    // No typed typeFilter access remains; only raw-frontmatter reads inside the migration.
    expect(src).not.toContain("typeFilter: dbConfig.typeFilter");
    expect(src).not.toContain("typeFilter: view.typeFilter");
    expect(src).not.toContain("db.typeFilter");
    expect(src).not.toContain("config.typeFilter");
    expect(src).not.toContain("typeFilter?: string");
    // legacyViewKeys no longer treats typeFilter as a shared/db-level key.
    const legacyBlock = src.match(/legacyViewKeys\(\)[\s\S]*?\]/);
    expect(legacyBlock, "legacyViewKeys must exist").not.toBeNull();
    expect(legacyBlock![0]).not.toContain("typeFilter");
  });
});
