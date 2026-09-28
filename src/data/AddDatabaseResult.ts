import { DatabaseConfig, SourceRule, SourceRuleNode, StatusPresetDef } from "./types";
import type { StarterTemplateId } from "./DatabaseStarterTemplates";
import type { VaultStarterTemplate } from "./VaultStarterTemplates";

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
  starterTemplateId?: StarterTemplateId;
  customStarter?: VaultStarterTemplate;
  coverImage?: string;
  coverImagePositionY?: number;
  newRecordTemplate?: DatabaseConfig["newRecordTemplate"];
  includeStarterSamples?: boolean;
  /** The modal's generated folder should be recomputed from the final unique database name. */
  starterSourceFolderAuto?: boolean;
}

/** Apply the modal's collected globals onto a freshly built DatabaseConfig. Called by
 *  `buildDatabaseWithInferredColumns` (the shared scan→infer→confirm orchestrator used by
 *  both creation entry points: DatabaseView.addDatabase and the settings panel). Does NOT
 *  set `name` — uniqueness is the caller's job (getUniqueDatabaseName), so the caller
 *  passes the unique name into `buildDatabaseWithInferredColumns`. */
export function applyAddDatabaseResult(db: DatabaseConfig, result: AddDatabaseModalResult): void {
  if (result.coverImage !== undefined) db.coverImage = result.coverImage || undefined;
  if (result.coverImagePositionY !== undefined) db.coverImagePositionY = result.coverImagePositionY;
  if ("newRecordTemplate" in result) db.newRecordTemplate = result.newRecordTemplate;
  db.description = result.description || undefined;
  db.sourceFolder = result.sourceFolder;
  db.sourceRules = result.sourceRules;
  db.sourceLogic = result.sourceLogic;
  db.sourceRuleTree = result.sourceRuleTree;
  db.newRecordFolder = result.newRecordFolder;
  db.statusPresets = result.statusPresets;
  db.defaultStatusPresetId = result.defaultStatusPresetId;
}
