import { describe, expect, it } from "vitest";
import { getColumnDisplayType, getComputedFieldForColumn, getComputedStorageKey } from "../data/ColumnDisplay";

describe("ColumnDisplay", () => {
  it("uses computed result type as the display type", () => {
    const col = { key: "formula.done", label: "Done", type: "computed" as const, computedKey: "done" };
    const computedFields = [
      { key: "done", label: "Done", expression: "note.status == 'done'", type: "checkbox" as const },
    ];

    expect(getComputedFieldForColumn(col, computedFields)).toEqual(computedFields[0]);
    expect(getColumnDisplayType(col, computedFields)).toBe("checkbox");
    expect(getComputedStorageKey(col)).toBe("done");
  });

  it("falls back to text for computed fields without a known definition", () => {
    expect(getColumnDisplayType({ key: "formula.missing", label: "Missing", type: "computed" }, [])).toBe("text");
  });

  it("matches old formula-prefixed computed columns without an explicit computedKey", () => {
    const col = { key: "formula.done", label: "Done", type: "computed" as const };
    const computedFields = [
      { key: "done", label: "Done", expression: "note.status == 'done'", type: "checkbox" as const },
    ];

    expect(getComputedFieldForColumn(col, computedFields)).toEqual(computedFields[0]);
    expect(getComputedStorageKey(col)).toBe("done");
  });
});
