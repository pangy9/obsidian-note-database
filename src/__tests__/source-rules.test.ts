import { describe, expect, it, vi } from "vitest";
import { combineSourceRuleTrees, getAllSourceRules, mergeDbAndViewSourceRuleTrees, sourceRuleValuesStrictEqual, updateSourceRuleTreeKeyReferences } from "../data/SourceRules";
import { SourceRule, SourceRuleNode } from "../data/types";

vi.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
}));

describe("SourceRules", () => {
  it("does not duplicate identical source trees when combining inherited view rules", () => {
    const tree: SourceRuleNode = {
      type: "group",
      logic: "and",
      rules: [
        { field: "status", op: "eq", value: "active" },
        { field: "file.path", op: "contains", value: "Projects" },
      ],
    };

    expect(combineSourceRuleTrees(tree, JSON.parse(JSON.stringify(tree)) as SourceRuleNode)).toEqual(tree);
  });

  it("updates expression field references without changing string literals", () => {
    const tree: SourceRuleNode = {
      type: "expression",
      expression: "note.status == \"status\" && properties['status'] != 'status' && status == 'done'",
    };

    expect(updateSourceRuleTreeKeyReferences(tree, "status", "state")).toBe(true);
    expect(tree).toEqual({
      type: "expression",
      expression: "note[\"state\"] == \"status\" && properties[\"state\"] != 'status' && state == 'done'",
    });
  });

  it("does not rewrite unrelated string or array literals", () => {
    const tree: SourceRuleNode = {
      type: "expression",
      expression: "['status'].containsAny(tags) || title == `status`",
    };

    expect(updateSourceRuleTreeKeyReferences(tree, "status", "state")).toBe(false);
    expect(tree).toEqual({
      type: "expression",
      expression: "['status'].containsAny(tags) || title == `status`",
    });
  });

  it("matches imported base link targets for strict equality without loosening plain strings", () => {
    expect(sourceRuleValuesStrictEqual("Books/Design", {
      field: "file.links",
      op: "strictEq",
      value: "[[Books/Design.md]]",
      valueType: "string",
    })).toBe(true);
    expect(sourceRuleValuesStrictEqual("[[Books/Design|Design]]", {
      field: "related",
      op: "strictEq",
      value: "[[Books/Design.md]]",
      valueType: "string",
    })).toBe(true);
    expect(sourceRuleValuesStrictEqual("[[Books/Design]]", {
      field: "title",
      op: "strictEq",
      value: "Books/Design",
      valueType: "string",
    })).toBe(false);
  });
});

describe("mergeDbAndViewSourceRuleTrees", () => {
  const statusRule: SourceRule = { field: "status", op: "eq", value: "active" };
  const priorityRule: SourceRule = { field: "priority", op: "eq", value: "high" };
  const statusTree: SourceRuleNode = { type: "group", logic: "and", rules: [statusRule] };
  const priorityTree: SourceRuleNode = { type: "group", logic: "and", rules: [priorityRule] };

  it("keeps both db flat sourceRules and view sourceRuleTree (neither side dropped)", () => {
    const db = { sourceRules: [statusRule] };
    const view = { sourceRuleTree: priorityTree };
    const merged = mergeDbAndViewSourceRuleTrees(db, view);
    expect(getAllSourceRules(merged).map((rule) => rule.field).sort()).toEqual(["priority", "status"]);
  });

  it("keeps both db sourceRuleTree and view flat sourceRules (reverse flat/tree mix)", () => {
    const db = { sourceRuleTree: statusTree };
    const view = { sourceRules: [priorityRule] };
    const merged = mergeDbAndViewSourceRuleTrees(db, view);
    expect(getAllSourceRules(merged).map((rule) => rule.field).sort()).toEqual(["priority", "status"]);
  });

  it("drops the view side when view is undefined (view source-rules switch off)", () => {
    const db = { sourceRules: [statusRule] };
    const merged = mergeDbAndViewSourceRuleTrees(db, undefined);
    expect(getAllSourceRules(merged).map((rule) => rule.field)).toEqual(["status"]);
  });

  it("returns undefined when neither side carries rules", () => {
    expect(mergeDbAndViewSourceRuleTrees({}, undefined)).toBeUndefined();
  });

  it("does not duplicate the db tree when the view inherits an identical tree", () => {
    const merged = mergeDbAndViewSourceRuleTrees({ sourceRuleTree: statusTree }, { sourceRuleTree: JSON.parse(JSON.stringify(statusTree)) as SourceRuleNode });
    expect(merged).toEqual(statusTree);
  });
});
