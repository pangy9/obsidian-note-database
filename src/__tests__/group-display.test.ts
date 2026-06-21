import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { formatGroupKeyDisplay } from "../data/GroupDisplay";
import { setDateDisplayMode } from "../data/DateTimeFormat";
import { ColumnDef, ViewConfig } from "../data/types";

function makeConfig(columns: ColumnDef[]): ViewConfig {
  return {
    id: "view",
    name: "View",
    viewType: "table",
    sourceFolder: "",
    schema: { columns, computedFields: [] },
  };
}

describe("group display labels", () => {
  afterEach(() => setDateDisplayMode("always"));

  it("formats date and datetime group keys without changing the stored key", () => {
    setDateDisplayMode("always");
    const dateConfig = makeConfig([{ key: "due", label: "Due", type: "date" }]);
    const datetimeConfig = makeConfig([{ key: "meeting", label: "Meeting", type: "datetime" }]);

    const dateLabel = formatGroupKeyDisplay(dateConfig, "due", "2026-06-20");
    const datetimeLabel = formatGroupKeyDisplay(datetimeConfig, "meeting", "2026-06-20T00:00");

    expect(dateLabel).toMatch(/2026/);
    expect(dateLabel).not.toBe("2026-06-20");
    expect(datetimeLabel).toMatch(/2026/);
    expect(datetimeLabel).toMatch(/00:00/);
    expect(datetimeLabel).not.toContain("T");
  });

  it("wires human group labels into shared group renderers", () => {
    for (const file of [
      "../views/TableRenderer.ts",
      "../views/BoardRenderer.ts",
      "../views/GalleryRenderer.ts",
      "../views/ListRenderer.ts",
      "../data/CalendarTimelineModel.ts",
      "../views/DatabaseView.ts",
      "../views/EmbeddedDatabaseRenderer.ts",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("formatGroupKeyDisplay");
    }
  });
});
