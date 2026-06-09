import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { getComputedFrontmatterCleanupOptions } from "../data/ComputedCleanup";
import { ColumnDef } from "../data/types";

function row(frontmatter: Record<string, unknown>): { frontmatter: Record<string, unknown> } {
  return { frontmatter };
}

describe("computed frontmatter cleanup", () => {
  it("uses the computed storage key that was written to note frontmatter", () => {
    const columns: ColumnDef[] = [
      { key: "file.name", label: "Name", type: "text" },
      { key: "formula.score", label: "Score", type: "computed", computedKey: "score_formula" },
      { key: "plain_formula", label: "Plain", type: "computed" },
      { key: "status", label: "Status", type: "status" },
    ];

    expect(getComputedFrontmatterCleanupOptions(columns)).toEqual([
      {
        key: "score_formula",
        label: "Score",
        columnKey: "formula.score",
        recordCount: 0,
      },
      {
        key: "plain_formula",
        label: "Plain",
        columnKey: "plain_formula",
        recordCount: 0,
      },
    ]);
  });

  it("filters to computed storage keys that exist in database-scoped frontmatter", () => {
    const columns: ColumnDef[] = [
      { key: "formula.saved", label: "Saved", type: "computed", computedKey: "saved_formula" },
      { key: "formula.empty", label: "Empty", type: "computed", computedKey: "empty_formula" },
      { key: "status", label: "Status", type: "status" },
    ];

    expect(getComputedFrontmatterCleanupOptions(columns, [
      row({ saved_formula: 1 }),
      row({ saved_formula: 2, status: "Done" }),
      row({ status: "Todo" }),
    ])).toEqual([
      {
        key: "saved_formula",
        label: "Saved",
        columnKey: "formula.saved",
        recordCount: 2,
      },
    ]);
  });

  it("deduplicates repeated computed storage keys", () => {
    const columns: ColumnDef[] = [
      { key: "formula.a", label: "A", type: "computed", computedKey: "shared" },
      { key: "formula.b", label: "B", type: "computed", computedKey: "shared" },
    ];

    expect(getComputedFrontmatterCleanupOptions(columns)).toEqual([
      {
        key: "shared",
        label: "A",
        columnKey: "formula.a",
        recordCount: 0,
      },
    ]);
  });

  it("wires cleanup through settings, modal, and database-scoped frontmatter deletion", () => {
    const panel = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const modal = readFileSync(new URL("../views/modals/ComputedFrontmatterCleanupModal.ts", import.meta.url), "utf8");

    expect(panel).toContain("onComputedFrontmatterCleanup");
    expect(panel).toContain("viewConfig.computedCleanup.button");
    expect(dashboard).toContain("showComputedFrontmatterCleanupModal");
    expect(dashboard).toContain("clearComputedFrontmatterProperties");
    expect(dashboard).toContain("getComputedFrontmatterCleanupOptions(config.schema.columns, records)");
    expect(dashboard).toContain("db.computedSyncMode = \"display-only\"");
    expect(dashboard).toContain("window.clearTimeout(this.computedSyncTimer)");
    expect(dashboard).toContain("this.dataSource.getRecordsForDatabase(this.getEffectiveConfig(db, config))");
    expect(dashboard).toContain("this.dataSource.updateFrontmatter(record.file, updates)");
    expect(modal).toContain("db-computed-cleanup-option");
    expect(modal).toContain("type: \"checkbox\"");
    expect(modal).toContain("selectedKeys");
    expect(modal).toContain("viewConfig.computedCleanup.optionField");
    expect(modal).toContain("viewConfig.computedCleanup.optionKey");
    expect(modal).toContain("viewConfig.computedCleanup.confirm");
  });
});
