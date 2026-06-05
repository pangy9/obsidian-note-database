import { describe, expect, it, vi } from "vitest";
import { combineSourceRuleTrees, sourceRuleValuesStrictEqual, updateSourceRuleTreeKeyReferences } from "../data/SourceRules";
import { SourceRuleNode } from "../data/types";

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
