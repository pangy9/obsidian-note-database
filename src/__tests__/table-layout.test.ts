import { describe, expect, it } from "vitest";
import { getTableColumnStyle, getTableLayout, getTableMinWidth } from "../views/TableLayout";

describe("TableLayout", () => {
  it("uses real column widths without a hard-coded minimum", () => {
    expect(getTableMinWidth(34, [120, 180])).toBe(334);
  });

  it("leaves the last column flexible so it absorbs remaining space", () => {
    expect(getTableLayout(34, [120, 180, 220], 700)).toEqual({
      tableWidth: 700,
      columnWidths: [120, 180, 366],
    });
    expect(getTableColumnStyle(366, 2, 3)).toEqual({ width: "366px" });
  });

  it("preserves user widths when columns exceed the container", () => {
    expect(getTableLayout(34, [240, 260, 280], 500)).toEqual({
      tableWidth: 814,
      columnWidths: [240, 260, 280],
    });
  });
});
