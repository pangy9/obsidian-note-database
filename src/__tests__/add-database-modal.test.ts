import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AddDatabaseModalResult, applyAddDatabaseResult } from "../data/AddDatabaseResult";
import type { DatabaseConfig } from "../data/types";

// The new-database modal reuses the settings-popover renderer so the user can set all
// database globals (name, description, source folder, source rules, new-record folder,
// status presets) in one pass at creation — instead of creating first and editing in the
// popover afterwards. computedSyncMode is intentionally omitted (no formula columns exist
// yet at creation, so it would be a no-op). Column inference respects the source rules
// the user sets, including the full AND/OR/NOT tree.

const shell = (): DatabaseConfig => ({
  id: "db1",
  name: "Shell",
  sourceFolder: "",
  schema: { columns: [], computedFields: [] },
  views: [],
});

describe("applyAddDatabaseResult", () => {
  it("applies description / source folder / source rules / new-record folder / status presets", () => {
    const db = shell();
    const result: AddDatabaseModalResult = {
      name: "My DB",
      description: "desc",
      sourceFolder: "Notes",
      sourceRules: [{ field: "status", op: "eq", value: "active" }],
      sourceLogic: "and",
      sourceRuleTree: { field: "type", op: "eq", value: "book" },
      newRecordFolder: "Notes/Inbox",
      statusPresets: [{ id: "p1", name: "Todo", options: [] }],
      defaultStatusPresetId: "p1",
    };
    applyAddDatabaseResult(db, result);
    expect(db.description).toBe("desc");
    expect(db.sourceFolder).toBe("Notes");
    expect(db.sourceRules).toEqual([{ field: "status", op: "eq", value: "active" }]);
    expect(db.sourceRuleTree).toEqual({ field: "type", op: "eq", value: "book" });
    expect(db.newRecordFolder).toBe("Notes/Inbox");
    expect(db.statusPresets).toEqual([{ id: "p1", name: "Todo", options: [] }]);
    expect(db.defaultStatusPresetId).toBe("p1");
  });

  it("does NOT set name — uniqueness is the caller's job", () => {
    const db = shell(); // name = "Shell"
    applyAddDatabaseResult(db, { name: "Other", sourceFolder: "" });
    expect(db.name).toBe("Shell");
  });

  it("clears description when absent (does not leave a stale value)", () => {
    const db = shell();
    db.description = "old";
    applyAddDatabaseResult(db, { name: "x", sourceFolder: "" });
    expect(db.description).toBeUndefined();
  });

  it("leaves status presets / default unset when the user did not customize (inherits global)", () => {
    const db = shell();
    applyAddDatabaseResult(db, { name: "x", sourceFolder: "" });
    expect(db.statusPresets).toBeUndefined();
    expect(db.defaultStatusPresetId).toBeUndefined();
    expect(db.sourceRuleTree).toBeUndefined();
    expect(db.newRecordFolder).toBeUndefined();
  });
});

describe("AddDatabaseModal wiring", () => {
  const modalSrc = readFileSync(new URL("../views/modals/AddDatabaseModal.ts", import.meta.url), "utf8");

  it("renders globals via the shared popover renderer inside a .note-database-container wrapper", () => {
    // The wrapper carries the scoped db-view-config-* styles (the base selector only sets
    // CSS variables, so it is safe inside a modal) → creation form looks identical to the
    // settings popover, with zero CSS duplication.
    expect(modalSrc).toContain('cls: "note-database-container"');
    expect(modalSrc).toContain("renderDatabaseGlobals(");
    expect(modalSrc).toContain("renderStatusPresetSettings(");
  });

  it("hosts dropdown popovers inside the modal (container-hosted, not body-hosted)", () => {
    // Body-hosted popovers in a modal lose focus (the modal refocuses its first input
    // when focus leaves modalEl, e.g. into a body-hosted search box) and miss the
    // `.note-database-container`-scoped dropdown/search styles. So the globals wrapper
    // carries `.note-database-container` (container-host) and the modal must NOT add
    // `.note-database-modal` (which would force body-hosting).
    expect(modalSrc).toContain('cls: "note-database-container"');
    expect(modalSrc).not.toContain('addClass("note-database-modal")');
  });

  it("re-renders the globals on database changes (source-rule add/edit must show)", () => {
    // The settings popover rebuilds its panel via refresh() on onDatabaseChange; the modal
    // must do the equivalent, otherwise adding a source rule mutates tempDb but never shows.
    expect(modalSrc).toContain("onDatabaseChange: () => this.scheduleRerender()");
    expect(modalSrc).toContain("private scheduleRerender()");
    // Deferred (rAF) so the rebuild doesn't detach a button mid-click.
    expect(modalSrc).toContain("requestAnimationFrame");
  });

  it("collects all six globals on create", () => {
    expect(modalSrc).toContain("description:");
    expect(modalSrc).toContain("sourceRuleTree:");
    expect(modalSrc).toContain("newRecordFolder:");
    expect(modalSrc).toContain("statusPresets:");
    expect(modalSrc).toContain("defaultStatusPresetId:");
  });

  it("lets the user manage status presets at creation (writes back + re-renders)", () => {
    expect(modalSrc).toContain("StatusPresetManagerModal");
    expect(modalSrc).toContain("onManageStatusPresets");
    expect(modalSrc).toContain("this.renderGlobals()");
  });
});

describe("addDatabase column inference respects source rules", () => {
  const flowSrc = readFileSync(new URL("../views/modals/AddDatabaseFlow.ts", import.meta.url), "utf8");

  it("passes the modal's source rule tree (and flat rules + logic) to collectFileFrontmatterKeys", () => {
    expect(flowSrc).toContain("collectFileFrontmatterKeys(app, sourceFolder, result.sourceRules");
    expect(flowSrc).toContain("result.sourceLogic, result.sourceRuleTree");
  });
});
