import { App, Notice } from "obsidian";
import { ColumnDef, DatabaseConfig, ViewConfig, generateId } from "../../data/types";
import { isObsidianTagsKey } from "../../data/ColumnTypes";
import {
  collectFileFrontmatterKeys,
  collectUniqueListValues,
  collectUniqueStringValues,
  getVaultTags,
  inferColumnType,
} from "../../data/FrontmatterScanner";
import { AddDatabaseModalResult, applyAddDatabaseResult } from "../../data/AddDatabaseResult";
import { BaseImportColumn, BaseImportConfirmModal } from "./BaseImportConfirmModal";
import { t } from "../../i18n";

/**
 * Build a DatabaseConfig from a new-database modal result: scan the source folder for
 * frontmatter keys, infer column types, pre-fill option values, and let the user
 * confirm/adjust the import via BaseImportConfirmModal.
 *
 * Shared by both creation entry points — the dashboard/toolbar entry
 * (DatabaseView.addDatabase) and the settings-panel entry (renderAddDatabaseButton) —
 * so neither can drift out of sync (the settings path previously skipped this step and
 * built a bare file.name-only config).
 *
 * Returns null if the user cancels the confirm modal. Does NOT write to disk or refresh
 * UI — the caller owns that.
 */
export async function buildDatabaseWithInferredColumns(
  app: App,
  result: AddDatabaseModalResult,
  dbName: string,
): Promise<DatabaseConfig | null> {
  const sourceFolder = result.sourceFolder || "";

  // Scan frontmatter from source folder. Pass the modal's source rules (including the
  // full rule tree) so column inference only considers records that will actually belong
  // to the database — same semantics as the query engine.
  const allKeys = new Map<string, string>();
  allKeys.set("file.name", t("defaults.nameColumn"));
  const sampleValues = new Map<string, unknown[]>();
  const fileCounts = new Map<string, number>();
  collectFileFrontmatterKeys(app, sourceFolder, result.sourceRules, allKeys, sampleValues, fileCounts, result.sourceLogic, result.sourceRuleTree);

  // Build column list: always start with file.name
  const columns: ColumnDef[] = [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }];

  if (allKeys.size > 1) {
    // Found frontmatter keys — show confirmation modal
    const STATUS_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
    const inferredColumns: BaseImportColumn[] = [];

    for (const [key, label] of allKeys) {
      if (key === "file.name") continue;
      const type = inferColumnType(key, sampleValues.get(key) || []);
      const col: BaseImportColumn = { key, label, type, fileCount: fileCounts.get(key) || 0 };

      // Pre-populate options for option-based types
      if (type === "multi-select" && isObsidianTagsKey(key)) {
        const vaultTags = getVaultTags(app, sourceFolder, undefined);
        if (vaultTags.length > 0) {
          col.statusOptions = vaultTags.map((tag: string, i: number) => ({
            value: tag,
            color: STATUS_COLORS[i % STATUS_COLORS.length],
          }));
        }
      } else if (type === "multi-select") {
        const uniqueValues = collectUniqueListValues(app, key, sourceFolder, undefined);
        if (uniqueValues.length > 0) {
          col.statusOptions = uniqueValues.map((val: string, i: number) => ({
            value: val,
            color: STATUS_COLORS[i % STATUS_COLORS.length],
          }));
        }
      } else if (type === "select" || type === "status") {
        const uniqueValues = collectUniqueStringValues(app, key, sourceFolder, undefined);
        if (uniqueValues.length > 0) {
          col.statusOptions = uniqueValues.map((val: string, i: number) => ({
            value: val,
            color: STATUS_COLORS[i % STATUS_COLORS.length],
          }));
        }
      }

      inferredColumns.push(col);
    }

    const confirmed = await new BaseImportConfirmModal(
      app,
      inferredColumns,
      {
        titleText: t("addDatabase.scanTitle"),
        descText: t("addDatabase.scanDesc"),
        defaultUnchecked: true,
      }
    ).openAndWait();
    if (!confirmed) return null;

    // Collect statusOptions for columns where user changed to option types
    for (const col of confirmed) {
      if ((col.type === "status" || col.type === "select" || col.type === "multi-select") && !col.statusOptions) {
        const uniqueValues = collectUniqueStringValues(app, col.key, sourceFolder, undefined);
        if (uniqueValues.length > 0) {
          col.statusOptions = uniqueValues.map((val: string, i: number) => ({
            value: val,
            color: STATUS_COLORS[i % STATUS_COLORS.length],
          }));
        }
      }
      columns.push({ key: col.key, label: col.label || col.key, type: col.type, statusOptions: col.statusOptions });
    }
  } else {
    // No frontmatter found
    new Notice(t("notice.noImportableProperties"));
  }

  const view: ViewConfig = {
    id: generateId(),
    name: t("common.tableView"),
    viewType: "table",
    sourceFolder: "",
    schema: { columns, computedFields: [] },
  };
  const newDb: DatabaseConfig = {
    id: generateId(),
    name: dbName,
    sourceFolder,
    schema: view.schema,
    views: [view],
  };
  applyAddDatabaseResult(newDb, result);

  return newDb;
}
