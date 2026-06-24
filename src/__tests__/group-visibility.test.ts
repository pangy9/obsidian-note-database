import { describe, expect, it } from "vitest";
import { getDefaultShowEmptyGroups, getGroupRowLimit, getGroupVisibleCount, isEmptyGroupVisibilityColumn, setGroupExpandedCount, setShowEmptyGroups, shouldShowEmptyGroups, withEmptyOptionGroups } from "../data/GroupVisibility";
import { ColumnDef, ViewConfig } from "../data/types";

function config(columns: ColumnDef[], showEmptyGroups?: Record<string, boolean>): ViewConfig {
  return {
    id: "view",
    name: "View",
    viewType: "table",
    sourceFolder: "",
    schema: { columns, computedFields: [] },
    showEmptyGroups,
  };
}

describe("empty group visibility", () => {
  it("defaults select and status groups to visible and multi-select groups to hidden", () => {
    const view = config([
      { key: "status", label: "Status", type: "status" },
      { key: "kind", label: "Kind", type: "select" },
      { key: "tags", label: "Tags", type: "multi-select" },
      { key: "title", label: "Title", type: "text" },
    ]);

    expect(shouldShowEmptyGroups(view, "status")).toBe(true);
    expect(shouldShowEmptyGroups(view, "kind")).toBe(true);
    expect(shouldShowEmptyGroups(view, "tags")).toBe(false);
    expect(shouldShowEmptyGroups(view, "title")).toBe(true);
  });

  it("only exposes the popover switch for option-like grouping fields", () => {
    const view = config([
      { key: "status", label: "Status", type: "status" },
      { key: "kind", label: "Kind", type: "select" },
      { key: "tags", label: "Tags", type: "multi-select" },
      { key: "title", label: "Title", type: "text" },
    ]);

    expect(view.schema.columns.map((column) => isEmptyGroupVisibilityColumn(view, column))).toEqual([true, true, true, false]);
  });

  it("persists only user overrides from the field default", () => {
    const view = config([
      { key: "status", label: "Status", type: "status" },
      { key: "tags", label: "Tags", type: "multi-select" },
    ]);

    setShowEmptyGroups(view, "status", false);
    setShowEmptyGroups(view, "tags", true);
    expect(view.showEmptyGroups).toEqual({ status: false, tags: true });

    setShowEmptyGroups(view, "status", getDefaultShowEmptyGroups(view, view.schema.columns[0]));
    expect(view.showEmptyGroups).toEqual({ tags: true });

    setShowEmptyGroups(view, "tags", false);
    expect(view.showEmptyGroups).toBeUndefined();
  });

  it("adds empty option groups without removing the real uncategorized group", () => {
    const view = config([
      {
        key: "status",
        label: "Status",
        type: "status",
        statusOptions: [
          { value: "Todo", color: "blue" },
          { value: "Done", color: "green" },
        ],
      },
    ]);
    const groups = withEmptyOptionGroups(view, "status", [
      { key: "Todo", rows: [], count: 1 },
      { key: "Uncategorized", rows: [], count: 2 },
    ]);

    expect(groups.map((group) => group.key)).toEqual(["Todo", "Uncategorized", "Done"]);
  });

  it("does not add empty multi-select option groups unless enabled", () => {
    const view = config([
      {
        key: "tags",
        label: "Tags",
        type: "multi-select",
        statusOptions: [
          { value: "Alpha", color: "blue" },
          { value: "Beta", color: "green" },
        ],
      },
    ]);

    expect(withEmptyOptionGroups(view, "tags", [{ key: "Alpha", rows: [], count: 1 }]).map((group) => group.key)).toEqual(["Alpha"]);
    setShowEmptyGroups(view, "tags", true);
    expect(withEmptyOptionGroups(view, "tags", [{ key: "Alpha", rows: [], count: 1 }]).map((group) => group.key)).toEqual(["Alpha", "Beta"]);
  });
});

describe("group row limit + progressive expand", () => {
  function view(overrides: Partial<ViewConfig> = {}): ViewConfig {
    return {
      id: "v", name: "V", viewType: "table", sourceFolder: "",
      schema: { columns: [], computedFields: [] },
      ...overrides,
    } as ViewConfig;
  }

  it("treats absent/zero groupRowLimit as no limit (shows all)", () => {
    expect(getGroupRowLimit(view())).toBe(0);
    expect(getGroupRowLimit(view({ groupRowLimit: 0 }))).toBe(0);
    expect(getGroupVisibleCount(view(), "f", "k", 100)).toBe(100);
    expect(getGroupVisibleCount(view({ groupRowLimit: 0 }), "f", "k", 100)).toBe(100);
  });

  it("caps visible count at the limit by default", () => {
    const v = view({ groupRowLimit: 25 });
    expect(getGroupRowLimit(v)).toBe(25);
    expect(getGroupVisibleCount(v, "f", "k", 83)).toBe(25);
    expect(getGroupVisibleCount(v, "f", "k", 10)).toBe(10); // smaller than limit → all
  });

  it("honors an expanded count (progressive +N)", () => {
    const v = view({ groupRowLimit: 25, expandedGroupRows: { f: { k: 50 } } });
    expect(getGroupVisibleCount(v, "f", "k", 83)).toBe(50);
    expect(getGroupVisibleCount(v, "f", "k", 40)).toBe(40); // clamp to total
  });

  it("treats expanded -1 as fully expanded", () => {
    const v = view({ groupRowLimit: 25, expandedGroupRows: { f: { k: -1 } } });
    expect(getGroupVisibleCount(v, "f", "k", 83)).toBe(83);
  });

  it("setGroupExpandedCount stores/clears and cleans empty maps", () => {
    const v = view({ groupRowLimit: 25 });
    setGroupExpandedCount(v, "f", "k", 50);
    expect(v.expandedGroupRows).toEqual({ f: { k: 50 } });
    setGroupExpandedCount(v, "f", "k", -1);
    expect(v.expandedGroupRows).toEqual({ f: { k: -1 } });
    setGroupExpandedCount(v, "f", "k", 0); // reset
    expect(v.expandedGroupRows).toBeUndefined();
  });
});
