import { DatabaseConfig, SourceRule, SourceRuleNode, StatusPresetDef } from "./types";

/** Globals collected by the new-database modal. The creation flow applies these to the
 *  freshly built DatabaseConfig via `applyAddDatabaseResult`. Source rules, new-record
 *  folder, description and status presets are optional — `undefined` means "inherit the
 *  default / leave unset", same as leaving the field empty in the settings popover. */
export interface AddDatabaseModalResult {
  name: string;
  description?: string;
  sourceFolder: string;
  sourceRules?: SourceRule[];
  sourceLogic?: "and" | "or";
  sourceRuleTree?: SourceRuleNode;
  newRecordFolder?: string;
  /** Per-database status presets. `undefined` = inherit global presets. */
  statusPresets?: StatusPresetDef[];
  /** Default status preset id. `undefined` = inherit the global default. */
  defaultStatusPresetId?: string;
}

/** Apply the modal's collected globals onto a freshly built DatabaseConfig. Shared by
 *  the file-database creation flow (DatabaseView.addDatabase, which also scans for
 *  inferred columns) and the settings-panel creation flow (settings.createEmptyDatabase,
 *  which builds a bare config). Does NOT set `name` — uniqueness is the caller's job
 *  (getUniqueDatabaseName), so the caller sets `db.name` itself. */
export function applyAddDatabaseResult(db: DatabaseConfig, result: AddDatabaseModalResult): void {
  db.description = result.description || undefined;
  db.sourceFolder = result.sourceFolder;
  db.sourceRules = result.sourceRules;
  db.sourceLogic = result.sourceLogic;
  db.sourceRuleTree = result.sourceRuleTree;
  db.newRecordFolder = result.newRecordFolder;
  db.statusPresets = result.statusPresets;
  db.defaultStatusPresetId = result.defaultStatusPresetId;
}
