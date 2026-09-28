import { App, Notice, TFile } from "obsidian";
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
import { buildStarterDatabaseConfig, getStarterRecordFolder, getStarterTemplate } from "../../data/DatabaseStarterTemplates";
import { getStarterArtworkFiles } from "../../data/DatabaseStarterArtwork";
import type { DataSource } from "../../data/DataSource";
import { DataHistoryFailure } from "../../data/EmbeddedDataHistory";
import type { NewDatabaseConflictPreparation } from "../PropertyTypeConflictWorkflow";
import { instantiateVaultStarter, cleanStarterSamples } from "../../data/VaultStarterTemplates";

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
  databaseFolder = "",
): Promise<DatabaseConfig | null> {
  if (result.starterTemplateId || result.customStarter) {
    const starter = result.customStarter || getStarterTemplate(result.starterTemplateId);
    if (!starter) return null;
    const sourceFolder = result.starterSourceFolderAuto || !result.sourceFolder
      ? getStarterRecordFolder(databaseFolder, dbName)
      : result.sourceFolder;
    const db = result.customStarter
      ? instantiateVaultStarter(result.customStarter, dbName, sourceFolder)
      : buildStarterDatabaseConfig(getStarterTemplate(result.starterTemplateId)!, dbName, sourceFolder, generateId);
    applyAddDatabaseResult(db, {
      ...result,
      sourceFolder,
      newRecordFolder: result.starterSourceFolderAuto ? sourceFolder : result.newRecordFolder || sourceFolder,
      statusPresets: result.statusPresets ?? db.statusPresets,
      defaultStatusPresetId: result.defaultStatusPresetId ?? db.defaultStatusPresetId,
    });
    return db;
  }
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

/** The dashboard and settings entry points share one preflight/write/rollback path. */
export async function createDatabaseFromModalResult(
  app: App,
  dataSource: DataSource,
  result: AddDatabaseModalResult,
  dbName: string,
  databaseFolder: string,
  prepareConflicts: (config: DatabaseConfig) => Promise<NewDatabaseConflictPreparation | null>,
): Promise<TFile | null> {
  const db = await buildDatabaseWithInferredColumns(app, result, dbName, databaseFolder);
  if (!db) return null;
  const starter = getStarterTemplate(result.starterTemplateId);
  if ((starter || result.customStarter) && result.starterSourceFolderAuto) {
    const prefix = `${db.sourceFolder.replace(/\/+$/, "")}/`;
    if (app.vault.getFiles().some((file) => file.path.startsWith(prefix))) {
      new Notice(t("starter.folderOccupied"));
      return null;
    }
  }
  // Custom templates reuse their vault references and do not have bundled artwork.
  const artwork = starter && !result.customStarter
    ? getStarterArtworkFiles(starter.id, db.sourceFolder).slice(0, result.includeStarterSamples === false ? 1 : undefined)
    : [];
  if (artwork.some((asset) => app.vault.getAbstractFileByPath(asset.path))) {
    new Notice(t("starter.artworkOccupied"));
    return null;
  }
  let conflicts: NewDatabaseConflictPreparation | null;
  try {
    conflicts = await prepareConflicts(db);
  } catch (error) {
    new Notice(t("errors.createFailed", { error: String(error) }));
    return null;
  }
  if (!conflicts) return null;

  const created: Array<{ file: TFile; content: string | null }> = [];
  const track = async (file: TFile): Promise<void> => {
    const item = { file, content: null as string | null };
    created.push(item);
    item.content = await app.vault.read(file);
  };
  try {
    const dbFile = await dataSource.createViewDefFile(databaseFolder, dbName, db);
    await track(dbFile);
    if (artwork.length > 0) {
      const folder = artwork[0].path.slice(0, artwork[0].path.lastIndexOf("/"));
      let part = "";
      for (const segment of folder.split("/").filter(Boolean)) {
        part = part ? `${part}/${segment}` : segment;
        if (!app.vault.getAbstractFileByPath(part)) await app.vault.createFolder(part);
      }
      for (const asset of artwork) {
        const file = await app.vault.create(asset.path, asset.content);
        await track(file);
      }
    }
    const samples = result.customStarter ? cleanStarterSamples(result.customStarter.samples, db) : starter?.samples;
    if (samples && result.includeStarterSamples !== false) {
      for (const sample of samples) {
        const frontmatter = { ...sample.frontmatter };
        if (sample.coverArtwork) frontmatter.cover = artwork[sample.coverArtwork]?.path;
        const file = await dataSource.createNote(db.newRecordFolder || db.sourceFolder, sample.filename, frontmatter, undefined, sample.body);
        await track(file);
      }
    }
    await conflicts.commit();
    return dbFile;
  } catch (error) {
    const retained: string[] = error instanceof DataHistoryFailure
      ? error.compensationErrors.map(({ step }) => step)
      : [];
    for (const item of created.reverse()) {
      try {
        if (item.content === null || app.vault.getAbstractFileByPath(item.file.path) !== item.file ||
          await app.vault.read(item.file) !== item.content) {
          retained.push(item.file.path);
          continue;
        }
        await dataSource.trashNote(item.file);
      } catch {
        retained.push(item.file.path);
      }
    }
    new Notice(t(starter || result.customStarter ? "starter.createFailed" : "errors.createFailed", { error: String(error) }));
    if (retained.length > 0) new Notice(t("starter.rollbackIncomplete", { paths: retained.join(", ") }), 10000);
    return null;
  }
}
