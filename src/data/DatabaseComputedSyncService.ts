import { App, Notice, TFile } from "obsidian";
import { t } from "../i18n";
import { getComputedStorageKey } from "./ColumnDisplay";
import { ComputedSyncCoordinator, ComputedSyncTarget } from "./ComputedSyncCoordinator";
import { evaluateComputedFields, hasRollupComputedDependency } from "./ComputedEvaluator";
import { DataChange, DataSource } from "./DataSource";
import { buildRelationRollups } from "./RelationRollup";
import { safeString } from "./SafeString";
import { normalizeComputedSyncMode } from "./ComputedSync";
import { DatabaseConfig, generateId } from "./types";
import { assertWriteValid, WriteInvalidatedError } from "./WriteValidity";

interface DatabaseSyncTarget extends ComputedSyncTarget {
  id: string;
  config: DatabaseConfig;
}

/** One automatic computed-result writer for the whole plugin instance. */
export class DatabaseComputedSyncService {
  private readonly sourceInstanceId = generateId();
  private readonly coordinator: ComputedSyncCoordinator<DataChange, DatabaseSyncTarget>;
  private readonly unsubscribeData: () => void;
  private readonly unsubscribeConfig: () => void;
  private knownDatabasePaths = new Set<string>();

  constructor(private readonly app: App, private readonly dataSource: DataSource) {
    this.coordinator = new ComputedSyncCoordinator<DataChange, DatabaseSyncTarget>({
      listTargets: () => this.getTargets(),
      isRelevant: (target, change) => this.isRelevant(target, change),
      syncTarget: (path, shouldContinue) => this.syncDatabase(path, shouldContinue),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (timer) => window.clearTimeout(timer),
      onError: (path, error) => {
        console.error(`Note Database: automatic computed sync failed for ${path}`, error);
        new Notice(t("errors.updateFailed", { error: String(error) }));
      },
    });
    this.unsubscribeData = this.dataSource.onDataChanged((batch) => {
      const changes = batch.changes.filter((change) => change.sourceInstanceId !== this.sourceInstanceId);
      const databasePaths = new Set([
        ...this.knownDatabasePaths,
        ...this.dataSource.getViewDefFiles().map((entry) => entry.file.path),
      ]);
      for (const change of changes) {
        if (databasePaths.has(change.path)) this.coordinator.invalidatePath(change.path);
        if (change.oldPath && databasePaths.has(change.oldPath)) this.coordinator.invalidatePath(change.oldPath);
      }
      this.coordinator.requestChanges(changes);
    });
    this.unsubscribeConfig = this.dataSource.onViewConfigChanged((mutation) => {
      if (mutation.sourceInstanceId === this.sourceInstanceId) return;
      if (mutation.dbPath) this.coordinator.requestPath(mutation.dbPath);
      else this.coordinator.requestAll();
    });
  }

  requestAll(): void {
    this.coordinator.requestAll();
  }

  destroy(): void {
    this.unsubscribeData();
    this.unsubscribeConfig();
    this.coordinator.destroy();
  }

  private getTargets(): DatabaseSyncTarget[] {
    const entries = this.dataSource.getViewDefFiles();
    this.knownDatabasePaths = new Set(entries.map((entry) => entry.file.path));
    return entries
      .filter(({ config }) =>
        normalizeComputedSyncMode(config.computedSyncMode) === "automatic" &&
        config.schema.computedFields.length > 0 &&
        config.schema.columns.some((column) => column.type === "computed")
      )
      .map(({ file, config }) => ({ path: file.path, id: config.id, config }));
  }

  private isRelevant(target: DatabaseSyncTarget, change: DataChange): boolean {
    if (change.path === target.path || change.oldPath === target.path) return true;
    const globallyDependent = target.config.schema.computedFields.some((definition) =>
      /\bbacklinks\b/i.test(definition.expression)
    ) || hasRollupComputedDependency(
      target.config.schema.computedFields,
      target.config.schema.columns
    );
    if (globallyDependent) return true;
    if (change.kind === "deleted") return false;
    const record = this.dataSource.getRecordSnapshot(change.path);
    const canonicalConfig = { ...target.config, baseThisFilePath: target.path };
    return record != null && this.dataSource.matchesRecordForDatabase(record, canonicalConfig);
  }

  private async syncDatabase(path: string, shouldContinue: () => boolean): Promise<void> {
    const entries = this.dataSource.getViewDefFiles();
    const entry = entries.find((candidate) => candidate.file.path === path);
    if (!entry || normalizeComputedSyncMode(entry.config.computedSyncMode) !== "automatic") return;
    const database = this.cloneDatabaseConfig(entry.config);
    database.baseThisFilePath = entry.file.path;
    const records = this.dataSource.getRecordsForDatabase(database);
    const databases = entries.map((candidate) => {
      const config = this.cloneDatabaseConfig(candidate.config);
      config.baseThisFilePath = candidate.file.path;
      return config;
    });
    if (!databases.some((candidate) => candidate.id === database.id)) databases.push(database);
    const derived = database.schema.columns.some((column) => column.type === "rollup")
      ? buildRelationRollups({
          app: this.app,
          sourceRecords: records,
          sourceDatabase: database,
          databases,
          getRecordsForDatabase: (target) => this.dataSource.getRecordsForDatabase(target),
        }).valuesByPath
      : undefined;
    const thisFile = this.app.vault.getAbstractFileByPath(path);
    const thisFrontmatter = thisFile instanceof TFile
      ? this.app.metadataCache.getFileCache(thisFile)?.frontmatter
      : undefined;
    const computedColumns = database.schema.columns.filter((column) => column.type === "computed");

    for (const record of records) {
      if (!shouldContinue()) return;
      const computed = evaluateComputedFields(
        database.schema.computedFields,
        database.schema.columns,
        record.frontmatter,
        {
          app: this.app,
          file: record.file,
          thisFile: thisFile instanceof TFile ? thisFile : undefined,
          thisFrontmatter,
          derivedValues: derived?.get(record.file.path),
        }
      );
      const updates: Record<string, unknown> = {};
      for (const column of computedColumns) {
        const key = getComputedStorageKey(column);
        const next = computed[key] == null ? "" : computed[key];
        if (safeString(record.frontmatter[key]) !== safeString(next)) updates[key] = next;
      }
      if (Object.keys(updates).length === 0) continue;
      if (!shouldContinue()) return;
      try {
        await this.dataSource.updateFrontmatter(record.file, updates, {
          sourceInstanceId: this.sourceInstanceId,
          assertWritable: () => assertWriteValid(shouldContinue),
        });
      } catch (error) {
        if (error instanceof WriteInvalidatedError) return;
        throw error;
      }
    }
  }

  private cloneDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
    return JSON.parse(JSON.stringify(config)) as DatabaseConfig;
  }
}
