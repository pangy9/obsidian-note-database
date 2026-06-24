import { describe, expect, it } from "vitest";
import { getColumnDisplayType, getComputedFieldForColumn, getComputedStorageKey, getNumberDisplayStyle, isNumberDisplayColumn } from "../data/ColumnDisplay";

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

  it("defaults the number display style to plain when unset", () => {
    expect(getNumberDisplayStyle({ key: "n", label: "N", type: "number" })).toBe("plain");
  });

  it("reads rating and progress number display styles", () => {
    expect(getNumberDisplayStyle({ key: "n", label: "N", type: "number", numberDisplayStyle: "rating" })).toBe("rating");
    expect(getNumberDisplayStyle({ key: "n", label: "N", type: "number", numberDisplayStyle: "progress" })).toBe("progress");
  });

  it("treats plain number columns as number-display, currency as not", () => {
    expect(isNumberDisplayColumn({ key: "n", label: "N", type: "number" })).toBe(true);
    expect(isNumberDisplayColumn({ key: "c", label: "C", type: "currency" })).toBe(false);
  });

  it("treats computed columns returning number as number-display", () => {
    const col = { key: "formula.score", label: "Score", type: "computed" as const, computedKey: "score" };
    const computedFields = [{ key: "score", label: "Score", expression: "a+b", type: "number" as const }];
    expect(isNumberDisplayColumn(col, computedFields)).toBe(true);
  });

  it("does not treat computed columns returning non-number as number-display", () => {
    const col = { key: "formula.name", label: "Name", type: "computed" as const, computedKey: "name" };
    const computedFields = [{ key: "name", label: "Name", expression: "a+b", type: "text" as const }];
    expect(isNumberDisplayColumn(col, computedFields)).toBe(false);
  });
});
