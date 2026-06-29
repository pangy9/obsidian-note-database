import { describe, expect, it } from "vitest";
import {
  applyRangeSelection,
  clearSelection,
  invertSelection,
  selectAll,
} from "../data/RangeSelection";

describe("range selection helper", () => {
  const ids = ["title", "status", "priority", "tags", "date"];

  it("toggles a single item and stores it as the range anchor", () => {
    const selected = new Set<string>();
    const anchor = applyRangeSelection({
      orderedIds: ids,
      selectedIds: selected,
      anchorId: null,
      targetId: "priority",
      selected: true,
      range: false,
    });

    expect([...selected]).toEqual(["priority"]);
    expect(anchor).toBe("priority");
  });

  it("applies shift range selection from the previous anchor to the target", () => {
    const selected = new Set<string>(["title"]);
    const anchor = applyRangeSelection({
      orderedIds: ids,
      selectedIds: selected,
      anchorId: "status",
      targetId: "tags",
      selected: true,
      range: true,
    });

    expect([...selected]).toEqual(["title", "status", "priority", "tags"]);
    expect(anchor).toBe("tags");
  });

  it("applies shift range deselection with the same selection state as the target", () => {
    const selected = new Set<string>(ids);
    const anchor = applyRangeSelection({
      orderedIds: ids,
      selectedIds: selected,
      anchorId: "status",
      targetId: "tags",
      selected: false,
      range: true,
    });

    expect([...selected]).toEqual(["title", "date"]);
    expect(anchor).toBe("tags");
  });

  it("falls back to single-item behavior when the anchor is missing from the ordered ids", () => {
    const selected = new Set<string>(["title"]);
    const anchor = applyRangeSelection({
      orderedIds: ids,
      selectedIds: selected,
      anchorId: "missing",
      targetId: "tags",
      selected: true,
      range: true,
    });

    expect([...selected]).toEqual(["title", "tags"]);
    expect(anchor).toBe("tags");
  });

  it("supports bulk select, clear, and invert against the same ordered ids", () => {
    const selected = new Set<string>(["status", "date"]);
    selectAll(ids, selected);
    expect([...selected]).toEqual(ids);

    clearSelection(ids, selected);
    expect([...selected]).toEqual([]);

    selected.add("priority");
    invertSelection(ids, selected);
    expect([...selected]).toEqual(["title", "status", "tags", "date"]);
  });
});
