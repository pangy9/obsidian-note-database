import { describe, expect, it, vi } from "vitest";
import { DatabaseConfig } from "../data/types";
import {
  getDefaultSourceRuleIsTypeValue,
  getDefaultSourceRuleOperatorForField,
  getSourceRuleIsTypeValueOptions,
  getSourceRuleOperatorGroupsForField,
} from "../views/ViewConfigPanelRenderer";

vi.mock("obsidian", () => ({
  Modal: class {},
  Notice: class {},
  setIcon: () => undefined,
}));

(globalThis as any).document = { documentElement: { lang: "en" } };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US" },
});

const db: DatabaseConfig = {
  id: "db",
  name: "DB",
  sourceFolder: "",
  schema: {
    columns: [
      { key: "score", label: "Score", type: "number" },
      { key: "price", label: "Price", type: "currency" },
      { key: "due", label: "Due", type: "date" },
      { key: "done", label: "Done", type: "checkbox" },
      { key: "tags", label: "Tags", type: "multi-select" },
      { key: "status", label: "Status", type: "status" },
      { key: "formula.ready", label: "Ready", type: "computed", computedKey: "ready" },
    ],
    computedFields: [
      { key: "ready", label: "Ready", expression: "note.done", type: "checkbox" },
    ],
  },
  views: [],
};

const opsFor = (field: string, current?: Parameters<typeof getSourceRuleOperatorGroupsForField>[2]) =>
  getSourceRuleOperatorGroupsForField(db, field, current).flatMap((group) => group.operators);

describe("source rule operators", () => {
  it("limits numeric fields to value, range, presence, and type operators", () => {
    const ops = opsFor("score");
    expect(ops).toContain("gt");
    expect(ops).toContain("lte");
    expect(ops).toContain("hasProperty");
    expect(opsFor("due")).toContain("hasProperty");
    expect(opsFor("price")).toContain("hasProperty");
    expect(ops).not.toContain("contains");
    expect(ops).not.toContain("inFolder");
    expect(ops).not.toContain("hasTag");
  });

  it("uses checkbox operators for computed checkbox formulas", () => {
    const ops = opsFor("formula.ready");
    expect(ops).toContain("truthy");
    expect(ops).toContain("eq");
    expect(ops).not.toContain("hasProperty");
    expect(ops).not.toContain("contains");
    expect(ops).not.toContain("gt");
  });

  it("adds field-specific file operators only where they make sense", () => {
    expect(opsFor("file.file")).toContain("inFolder");
    expect(opsFor("file.path")).toContain("inFolder");
    expect(opsFor("file.tags")).toContain("hasTag");
    expect(opsFor("file.links")).toContain("hasLink");
    expect(opsFor("file.properties")).not.toContain("hasProperty");
  });

  it("omits strict operators by default but preserves them for existing rules", () => {
    expect(opsFor("status")).not.toContain("strictEq");
    expect(opsFor("status")).not.toContain("strictNeq");
    expect(opsFor("status", "strictEq")[0]).toBe("strictEq");
  });

  it("does not offer truthy for multi-select list fields", () => {
    expect(opsFor("tags")).toContain("contains");
    expect(opsFor("tags")).toContain("hasTag");
    expect(opsFor("tags")).not.toContain("truthy");
  });

  it("preserves any existing unsupported operator while editing old rules", () => {
    const ops = opsFor("score", "inFolder");
    expect(ops[0]).toBe("inFolder");
    expect(getDefaultSourceRuleOperatorForField(db, "score")).toBe("eq");
  });

  it("defaults isType values from the selected field type", () => {
    expect(getDefaultSourceRuleIsTypeValue(db, "done")).toBe("boolean");
    expect(getDefaultSourceRuleIsTypeValue(db, "formula.ready")).toBe("boolean");
    expect(getDefaultSourceRuleIsTypeValue(db, "tags")).toBe("list");
    expect(getDefaultSourceRuleIsTypeValue(db, "due")).toBe("date");
    expect(getDefaultSourceRuleIsTypeValue(db, "score")).toBe("number");
    expect(getDefaultSourceRuleIsTypeValue(db, "status")).toBe("string");
  });

  it("keeps unknown isType values while normalizing known aliases", () => {
    expect(getSourceRuleIsTypeValueOptions("duration")[0]).toBe("duration");
    expect(getSourceRuleIsTypeValueOptions("checkbox")).not.toContain("checkbox");
    expect(getSourceRuleIsTypeValueOptions("checkbox")).toContain("boolean");
    expect(getSourceRuleIsTypeValueOptions("array")).not.toContain("array");
    expect(getSourceRuleIsTypeValueOptions("array")).toContain("list");
  });
});
