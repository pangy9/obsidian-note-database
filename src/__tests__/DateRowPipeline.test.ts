import { describe, expect, it, vi } from "vitest";
import { RowPipeline } from "../data/RowPipeline";
import { ViewStateStore } from "../views/ViewStateStore";
import type { NoteRecord } from "../data/DataSource";
import type { ViewConfig } from "../data/types";

vi.mock("obsidian", () => ({ TFile: class {} }));
vi.mock("../data/FileFieldObsidian", () => ({
  getRowFileFieldValue: vi.fn(),
}));
// Supply the raw datetime a formula would return; exercise the actual pipeline's
// computed result type resolution, sorting and filtering together.
vi.mock("../data/ComputedEvaluator", () => ({
  evaluateComputedFields: (_defs: unknown, _columns: unknown, frontmatter: Record<string, unknown>) => ({ day: frontmatter.time }),
}));

describe("computed date row pipeline", () => {
  it.each(["day", "formula.day"])("uses the result type when computedKey is %s", (computedKey) => {
    const config: ViewConfig = {
      name: "Test", sourceFolder: "",
      schema: {
        columns: [{ key: "result", label: "Day", type: "computed", computedKey }, { key: "rank", label: "Rank", type: "number" }],
        computedFields: [{ key: "day", label: "Day", expression: "time", type: "date" }],
      },
      filters: [{ field: "result", op: "eq", value: "2026-10-19" }],
      sortRules: [{ field: "result", direction: "asc" }, { field: "rank", direction: "asc" }],
    };
    const records: NoteRecord[] = ["2026-10-19T18:30", "2026-10-19T09:00", "2026-10-20T09:00"].map((time, rank) => ({
      file: { path: String(rank) } as NoteRecord["file"], frontmatter: { time, rank },
    }));
    const rows = new RowPipeline().build(records, config, new ViewStateStore().get(0, 0, config));
    expect(rows.map((row) => row.frontmatter.rank)).toEqual([0, 1]);
    expect(rows.map((row) => row.computed.day)).toEqual(["2026-10-19T18:30", "2026-10-19T09:00"]);
  });
});
