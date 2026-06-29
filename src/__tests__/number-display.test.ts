import { describe, expect, it, vi } from "vitest";
import { roundHalf, clampNumber, buildRatingSlots, progressFillPercent, formatProgressValue, ringGeometry } from "../data/NumberDisplay";
import { DataSource } from "../data/DataSource";

vi.mock("obsidian", () => ({
  App: class {},
  TFile: class {},
  EventRef: class {},
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
  stringifyYaml: (value: unknown) => JSON.stringify(value),
}));

function createDataSourceForParsing(): DataSource {
  return Object.create(DataSource.prototype) as DataSource;
}

describe("NumberDisplay.roundHalf", () => {
  it("rounds to the nearest half", () => {
    expect(roundHalf(3)).toBe(3);
    expect(roundHalf(3.2)).toBe(3);
    expect(roundHalf(3.25)).toBe(3.5);
    expect(roundHalf(3.5)).toBe(3.5);
    expect(roundHalf(3.7)).toBe(3.5);
    expect(roundHalf(3.8)).toBe(4);
    expect(roundHalf(0)).toBe(0);
  });
});

describe("NumberDisplay.clampNumber", () => {
  it("clamps within bounds", () => {
    expect(clampNumber(5, 0, 3)).toBe(3);
    expect(clampNumber(-1, 0, 3)).toBe(0);
    expect(clampNumber(2, 0, 3)).toBe(2);
  });
});

describe("NumberDisplay.buildRatingSlots", () => {
  it("renders 5 empty slots for 0", () => {
    expect(buildRatingSlots(0)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });

  it("renders full/half/empty for fractional values", () => {
    expect(buildRatingSlots(3)).toEqual(["full", "full", "full", "empty", "empty"]);
    expect(buildRatingSlots(3.5)).toEqual(["full", "full", "full", "half", "empty"]);
    expect(buildRatingSlots(4.5)).toEqual(["full", "full", "full", "full", "half"]);
  });

  it("clamps values above 5 to all-full and below 0 to all-empty", () => {
    expect(buildRatingSlots(5)).toEqual(["full", "full", "full", "full", "full"]);
    expect(buildRatingSlots(7)).toEqual(["full", "full", "full", "full", "full"]);
    expect(buildRatingSlots(-1)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });

  it("returns no slots for non-finite values (caller renders '-')", () => {
    expect(buildRatingSlots(NaN)).toEqual([]);
    expect(buildRatingSlots(Infinity)).toEqual([]);
  });

  it("honors a custom max star count", () => {
    expect(buildRatingSlots(7, 10)).toHaveLength(10);
    expect(buildRatingSlots(7, 10).filter((s) => s === "full").length).toBe(7);
    expect(buildRatingSlots(10, 10)).toEqual(["full", "full", "full", "full", "full", "full", "full", "full", "full", "full"]);
  });
});

describe("NumberDisplay.progressFillPercent", () => {
  it("treats value as percent when divisor = 100 (default)", () => {
    expect(progressFillPercent(75)).toBe(75);
    expect(progressFillPercent(0)).toBe(0);
    expect(progressFillPercent(100)).toBe(100);
  });

  it("scales value/divisor*100 and clamps to [0, 100]", () => {
    expect(progressFillPercent(750, 1000)).toBe(75);
    expect(progressFillPercent(7, 10)).toBe(70);
    expect(progressFillPercent(7.5, 10)).toBe(75);
    expect(progressFillPercent(1500, 1000)).toBe(100);
    expect(progressFillPercent(-10, 100)).toBe(0);
  });

  it("returns null for non-finite value or divisor", () => {
    expect(progressFillPercent(NaN, 100)).toBeNull();
    expect(progressFillPercent(75, 0)).toBeNull();
    expect(progressFillPercent(75, NaN)).toBeNull();
  });
});

describe("NumberDisplay.formatProgressValue", () => {
  it("formats the raw value without percent sign", () => {
    expect(formatProgressValue(750)).toBe("750");
    expect(formatProgressValue(7.5)).toBe("7.5");
    expect(formatProgressValue(0)).toBe("0");
  });
  it("trims floating-point noise", () => {
    expect(formatProgressValue(0.1 + 0.2)).toBe("0.3");
  });
  it("returns empty string for non-finite", () => {
    expect(formatProgressValue(NaN)).toBe("");
  });
});

describe("NumberDisplay.ringGeometry", () => {
  const RADIUS = 10;
  const circumference = 2 * Math.PI * RADIUS;

  it("computes circumference from radius", () => {
    expect(ringGeometry(0, RADIUS).circumference).toBeCloseTo(circumference, 5);
  });

  it("hides the full arc at 0% and draws it fully at 100%", () => {
    expect(ringGeometry(0, RADIUS).dashOffset).toBeCloseTo(circumference, 5);
    expect(ringGeometry(100, RADIUS).dashOffset).toBeCloseTo(0, 5);
  });

  it("draws half the arc at 50%", () => {
    expect(ringGeometry(50, RADIUS).dashOffset).toBeCloseTo(circumference / 2, 5);
  });

  it("clamps values outside [0, 100]", () => {
    expect(ringGeometry(150, RADIUS).dashOffset).toBeCloseTo(0, 5);
    expect(ringGeometry(-10, RADIUS).dashOffset).toBeCloseTo(circumference, 5);
  });
});

describe("numberDisplayStyle persistence", () => {
  it("round-trips numberDisplayStyle through parseDatabaseConfig", () => {
    const ds = createDataSourceForParsing();
    const fm = {
      db_view: true,
      database: {
        id: "db-1",
        name: "DB",
        sourceFolder: "",
        views: [],
        columns: [
          { key: "r", label: "Rating", type: "number", numberDisplayStyle: "rating" },
          { key: "p", label: "Progress", type: "number", numberDisplayStyle: "progress" },
          { key: "n", label: "Plain", type: "number" },
        ],
      },
    };
    const config = ds.parseDatabaseConfig(fm as never);
    const columns = config?.schema.columns ?? [];
    expect(columns[0].numberDisplayStyle).toBe("rating");
    expect(columns[1].numberDisplayStyle).toBe("progress");
    // Plain columns keep undefined (not serialized as the string "plain").
    expect(columns[2].numberDisplayStyle).toBeUndefined();
  });

  it("round-trips numberDisplayConfig through parseDatabaseConfig", () => {
    const ds = createDataSourceForParsing();
    const fm = {
      db_view: true,
      database: {
        id: "db-1",
        name: "DB",
        sourceFolder: "",
        views: [],
        columns: [
          {
            key: "r",
            label: "Rating",
            type: "number",
            numberDisplayStyle: "rating",
            numberDisplayConfig: { ratingSymbol: "flame", ratingVariant: "outline", ratingMax: 10, color: "red" },
          },
          {
            key: "e",
            label: "Emoji Rating",
            type: "number",
            numberDisplayStyle: "rating",
            numberDisplayConfig: { ratingSymbol: "emoji", ratingEmoji: "🔥", ratingMax: 5 },
          },
          {
            key: "p",
            label: "Progress",
            type: "number",
            numberDisplayStyle: "progress",
            numberDisplayConfig: { progressDivisor: 1000, progressShowValue: false, color: "green" },
          },
        ],
      },
    };
    const columns = ds.parseDatabaseConfig(fm as never)?.schema.columns ?? [];
    expect(columns[0].numberDisplayConfig).toEqual({ ratingSymbol: "flame", ratingVariant: "outline", ratingMax: 10, color: "red" });
    expect(columns[1].numberDisplayConfig).toEqual({ ratingSymbol: "emoji", ratingEmoji: "🔥", ratingMax: 5 });
    expect(columns[2].numberDisplayConfig).toEqual({ progressDivisor: 1000, progressShowValue: false, color: "green" });
  });

  it("round-trips view-level dateGroupModes / groupRowLimit / expandedGroupRows", () => {
    const ds = createDataSourceForParsing();
    const fm = {
      db_view: true,
      database: {
        id: "db-1", name: "DB", sourceFolder: "",
        columns: [], computedFields: [],
        views: [{
          id: "v1", name: "V", viewType: "table", sourceFolder: "",
          groupByField: "due",
          dateGroupModes: { due: "date" },
          groupRowLimit: 25,
          expandedGroupRows: { due: { "2026-06-24": 50 } },
        }],
      },
    };
    const view = ds.parseDatabaseConfig(fm as never)?.views[0];
    expect(view?.dateGroupModes).toEqual({ due: "date" });
    expect(view?.groupRowLimit).toBe(25);
    expect(view?.expandedGroupRows).toEqual({ due: { "2026-06-24": 50 } });
  });
});
