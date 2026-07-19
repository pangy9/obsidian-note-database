import { TFile, Vault, MetadataCache, App, normalizePath, parseYaml, stringifyYaml, EventRef, getAllTags } from "obsidian";
import { ChartReferenceLine, ColumnDef, ConditionalFormatRule, DatabaseConfig, DateGroupMode, FilterRule, NewRecordTemplateConfig, RecordSchema, SortRule, SourceRule, ViewConfig } from "./types";
import { generateId } from "./types";
import { evaluateBaseFilterExpression } from "./BaseExpression";
import { evaluateComputedFields } from "./ComputedEvaluator";
import { safeString } from "./SafeString";
import { hasObsidianTagValue, normalizeStatusPresets, OPTION_COLORS, toMultiSelectValues, toObsidianTagValues } from "./ColumnTypes";
import { normalizeComputedSyncMode } from "./ComputedSync";
import { fileHasLink, getBaseFileFieldType, getFileFieldValue, isBaseFileField } from "./FileFields";
import { absorbTypeFilterIntoRules, getSourceRuleTree, matchesBaseSourceType, matchesSourceRuleTree, parseSourceRuleTree, sourceRuleContainsValue, sourceRuleValuesLooseEqual, sourceRuleValuesStrictEqual } from "./SourceRules";
import { linkDatabaseSchema } from "./ColumnConfig";
import { t } from "../i18n";

const MAX_SOURCE_RULE_MATCH_TEXT_LENGTH = 10000;

interface DatabaseIdDedupTarget {
  file: TFile;
  oldId: string;
  newId: string;
  config: DatabaseConfig;
}

export interface NoteRecord {
  file: TFile;
  frontmatter: Record<string, unknown>;
}

export type DataChangeKind = "changed" | "created" | "deleted" | "renamed";
export type DataChangeOrigin = "plugin" | "external";
type DataChangeSignal = "metadata" | "vault";
export interface DataChange {
  kind: DataChangeKind;
  path: string;
  oldPath?: string;
  origin: DataChangeOrigin;
  sourceInstanceId?: string;
}
export interface DataChangeBatch {
  changes: DataChange[];
}
export type DataChangeCallback = (batch: DataChangeBatch) => void;
export type FrontmatterMutator = (frontmatter: Record<string, unknown>) => void;
export interface DataWriteContext {
  sourceInstanceId?: string;
}

interface OwnedWriteCredit {
  expiresAt: number;
  sourceInstanceId?: string;
}

export interface ViewConfigMutation {
  dbId?: string;
  dbPath?: string | null;
  viewId?: string;
  sourceInstanceId: string;
  database?: DatabaseConfig;
}

export type ViewConfigMutationCallback = (mutation: ViewConfigMutation) => void;

function compareDatabaseIdOwners(
  left: { file: TFile },
  right: { file: TFile }
): number {
  const leftCtime = Number.isFinite(left.file.stat?.ctime) ? left.file.stat.ctime : Number.POSITIVE_INFINITY;
  const rightCtime = Number.isFinite(right.file.stat?.ctime) ? right.file.stat.ctime : Number.POSITIVE_INFINITY;
  return leftCtime - rightCtime || left.file.path.localeCompare(right.file.path);
}

export class DataSource {
  private app: App;
  private vault: Vault;
  private metadataCache: MetadataCache;
  private listeners: DataChangeCallback[] = [];
  private viewConfigListeners: ViewConfigMutationCallback[] = [];
  private eventRefs: { offref: () => void }[] = [];
  private notifyTimer: number | null = null;
  private modifyRecheckTimers = new Map<string, number>();
  private pendingChanges = new Map<string, DataChange>();
  private ownedPathUntil = new Map<string, {
    metadataEvents: OwnedWriteCredit[];
    vaultEvents: OwnedWriteCredit[];
  }>();
  private recordCache: Map<string, NoteRecord> | null = null;
  private frontmatterOverrides = new Map<string, { values: Record<string, unknown>; expiresAt: number }>();
  private viewDefOverrides = new Map<string, { config: DatabaseConfig; expiresAt: number }>();
  /** Per-file write queue to serialize processFrontMatter calls on the same file */
  private writeQueues = new Map<string, Promise<void>>();

  constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.metadataCache = app.metadataCache;
  }

  /** Serialize async writes to the same file path to prevent overlapping processFrontMatter.
   *  Errors from a previous write do not block subsequent writes in the queue. */
  private enqueueWrite(
    path: string,
    operation: () => Promise<void>,
    context?: DataWriteContext
  ): Promise<void> {
    const prev = this.writeQueues.get(path) ?? Promise.resolve();
    // Swallow previous error so the queue is never poisoned, then run this operation
    const next = prev.catch(() => {}).then(() => {
      const credit = this.markOwnedPath(path, context?.sourceInstanceId);
      return operation().catch((error) => {
        this.releaseOwnedCredit(path, credit);
        throw error;
      });
    });
    this.writeQueues.set(path, next);
    // Clean up when this slot is the tail of the chain (whether fulfilled or rejected)
    const cleanup = () => {
      if (this.writeQueues.get(path) === next) {
        this.writeQueues.delete(path);
      }
    };
    next.then(cleanup, cleanup);
    return next;
  }

  onDataChanged(cb: DataChangeCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== cb);
    };
  }

  onViewConfigChanged(cb: ViewConfigMutationCallback): () => void {
    this.viewConfigListeners.push(cb);
    return () => {
      this.viewConfigListeners = this.viewConfigListeners.filter((listener) => listener !== cb);
    };
  }

  notifyViewConfigChanged(mutation: ViewConfigMutation): void {
    for (const cb of this.viewConfigListeners) {
      cb(mutation);
    }
  }

  /** Register metadata cache and vault events */
  startListening(registerEvent?: (eventRef: EventRef) => void): void {
    const track = (eventRef: EventRef) => {
      if (registerEvent) registerEvent(eventRef);
      else this.trackEvent(eventRef);
    };
    // "resolved" has no file identity and fires broadly; concrete cache/vault
    // events below are the authoritative refresh signal.
    track(this.metadataCache.on("changed", (file) => {
      this.cancelModifyRecheck(file.path);
      // metadataCache.changed is the hand-off from optimistic plugin overlays
      // to Obsidian's authoritative parsed frontmatter. Keeping an older
      // override beyond this point can mask a newer external save indefinitely
      // because expiry alone does not schedule another render.
      this.frontmatterOverrides.delete(file.path);
      this.viewDefOverrides.delete(file.path);
      this.refreshCachedRecord(file);
      this.scheduleNotify("changed", file.path, undefined, "metadata");
    }));
    track(this.vault.on("modify", (file) => {
      this.scheduleNotify("changed", file.path, undefined, "vault");
      this.scheduleModifyRecheck(file);
    }));
    track(this.vault.on("create", (file) => {
      this.refreshCachedRecord(file);
      this.scheduleNotify("created", file.path, undefined, "vault");
    }));
    track(this.vault.on("delete", (file) => {
      this.recordCache?.delete(file.path);
      this.scheduleNotify("deleted", file.path, undefined, "vault");
    }));
    track(this.vault.on("rename", (file, oldPath) => {
      this.recordCache?.delete(oldPath);
      this.refreshCachedRecord(file);
      this.scheduleNotify("renamed", file.path, oldPath, "vault");
    }));
  }

  /** Unregister all events — call from plugin onunload() */
  destroy(): void {
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    for (const timer of this.modifyRecheckTimers.values()) window.clearTimeout(timer);
    this.modifyRecheckTimers.clear();
    for (const ref of this.eventRefs) {
      ref.offref();
    }
    this.eventRefs = [];
    this.listeners = [];
    this.viewConfigListeners = [];
    this.writeQueues.clear();
    this.pendingChanges.clear();
    this.ownedPathUntil.clear();
    this.recordCache = null;
  }

  private trackEvent(ref: unknown): void {
    const eventRef = ref as { offref?: unknown } | null;
    if (typeof eventRef?.offref === "function") {
      this.eventRefs.push(eventRef as { offref: () => void });
    }
  }

  /** Get all notes in a folder */
  getNotesInFolder(folderPath: string): NoteRecord[] {
    const normalizedFolder = this.normalizeVaultFolder(folderPath);
    const prefix = normalizedFolder ? (normalizedFolder.endsWith("/") ? normalizedFolder : normalizedFolder + "/") : "";
    return this.getCachedRecords()
      .filter((record) => !prefix || record.file.path.startsWith(prefix))
      .filter((r) => r.frontmatter["db_view"] !== true);
  }

  /** Query records using database-level config (sourceFolder, sourceRules) */
  getRecordsForDatabase(db: DatabaseConfig): NoteRecord[] {
    const matches = this.createRecordDatabaseMatcher(db);
    return this.getCachedRecords().filter(matches);
  }

  /** Match an in-memory candidate record with exactly the same source semantics as a vault query. */
  matchesRecordForDatabase(record: NoteRecord, db: DatabaseConfig): boolean {
    return this.createRecordDatabaseMatcher(db)(record);
  }

  getRecordSnapshot(path: string): NoteRecord | null {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return null;
    const raw = this.recordCache?.get(path) || this.toRawRecord(file);
    return this.applyFrontmatterOverride(raw);
  }

  /** Mark an imminent write performed by a caller that cannot use DataSource IO helpers. */
  markPluginWrite(path: string, sourceInstanceId?: string): void {
    this.markOwnedPath(path, sourceInstanceId);
  }

  /** Recovery path for an explicit force refresh when filesystem events may have been missed. */
  invalidateRecordCache(): void {
    this.recordCache = null;
  }

  private createRecordDatabaseMatcher(db: DatabaseConfig): (record: NoteRecord) => boolean {
    const effectiveRules = this.getEffectiveSourceRules(db);
    const sourceRuleTree = getSourceRuleTree(db.sourceRuleTree, effectiveRules, db.sourceLogic);
    return (record) => {
      if (record.file.extension !== "md" || record.frontmatter["db_view"] === true) return false;
      if (db.sourceFolder && !this.isInFolder(record.file, db.sourceFolder)) return false;
      if (sourceRuleTree && !matchesSourceRuleTree(
        sourceRuleTree,
        (rule) => this.matchesSourceRule(record, rule, db),
        (rule) => this.matchesSourceExpression(record, rule.expression, db)
      )) return false;
      return true;
    };
  }

  private getEffectiveSourceRules(db: DatabaseConfig): SourceRule[] {
    const rules = db.sourceRules || [];
    const sourceFolder = this.normalizeVaultFolder(db.sourceFolder);
    if (!sourceFolder) return rules;
    // Keep narrower folder rules. Only remove the duplicate rule already enforced by sourceFolder.
    return rules.filter((rule) => (
      rule.op !== "inFolder" ||
      this.normalizeVaultFolder(String(rule.value ?? "")) !== sourceFolder
    ));
  }

  /** Backward-compatible alias */
  getRecordsForConfig(db: DatabaseConfig): NoteRecord[] {
    return this.getRecordsForDatabase(db);
  }

  /** Modify a note's frontmatter with a queued mutator and remember changed keys for immediate reads. */
  async mutateFrontmatter(
    file: TFile,
    mutator: FrontmatterMutator,
    context?: DataWriteContext
  ): Promise<void> {
    return this.enqueueWrite(file.path, async () => {
      let updates: Record<string, unknown> | null = null;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const frontmatter = fm as Record<string, unknown>;
          const before = this.cloneFrontmatter(frontmatter);
          mutator(frontmatter);
          updates = this.diffFrontmatter(before, frontmatter);
        });
        if (updates && Object.keys(updates).length > 0) {
          this.rememberFrontmatterUpdates(file.path, updates);
        }
      } catch (err) {
        if (updates && Object.keys(updates).length > 0) this.frontmatterOverrides.delete(file.path);
        throw err;
      }
    }, context);
  }

  /** Modify a note's frontmatter fields using the official API.
   *  Writes to the same file are serialized to prevent overlapping processFrontMatter. */
  async updateFrontmatter(
    file: TFile,
    updates: Record<string, unknown>,
    context?: DataWriteContext
  ): Promise<void> {
    return this.mutateFrontmatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) delete frontmatter[key];
        else frontmatter[key] = value;
      }
    }, context);
  }

  /** Create a new note in a folder with the given frontmatter */
  async createNote(
    folderPath: string,
    filename: string,
    frontmatter: Record<string, unknown>,
    context?: DataWriteContext,
    body = "",
  ): Promise<TFile> {
    const yaml = stringifyYaml(frontmatter).trim();
    const content = "---\n" + yaml + "\n---\n\n" + body.replace(/^\r?\n+/, "");
    const safeFilename = filename.replace(/[\\/]/g, "-").trim() || "Untitled";
    const folder = this.normalizeVaultFolder(folderPath);
    await this.ensureFolder(folder);
    const basePath = normalizePath(folder ? `${folder}/${safeFilename}.md` : `${safeFilename}.md`);
    const path = this.getAvailablePath(basePath);
    const credit = this.markOwnedPath(path, context?.sourceInstanceId);
    let file: TFile;
    try {
      file = await this.app.vault.create(path, content);
    } catch (error) {
      this.releaseOwnedCredit(path, credit);
      throw error;
    }
    if (this.recordCache) {
      this.recordCache.set(file.path, {
        file,
        frontmatter: this.cloneFrontmatter(frontmatter),
      });
    }
    return file;
  }

  /** 复制笔记全文(frontmatter + body)到同目录,返回新文件。nameSuffix 如 "copy"/"副本"。 */
  async duplicateNote(file: TFile, nameSuffix: string, context?: DataWriteContext): Promise<TFile> {
    const content = await this.app.vault.read(file);
    const copyName = `${file.basename} ${nameSuffix}`;
    const parent = file.parent;
    const basePath = normalizePath(parent && parent.path ? `${parent.path}/${copyName}.md` : `${copyName}.md`);
    const path = this.getAvailablePath(basePath);
    const credit = this.markOwnedPath(path, context?.sourceInstanceId);
    let copy: TFile;
    try {
      copy = await this.app.vault.create(path, content);
    } catch (error) {
      this.releaseOwnedCredit(path, credit);
      throw error;
    }
    if (this.recordCache) {
      this.recordCache.set(copy.path, {
        file: copy,
        frontmatter: this.getFrontmatterSnapshot(file),
      });
    }
    return copy;
  }

  /** Open a note in the workspace */
  openNote(file: TFile): void {
    void this.app.workspace.getLeaf(false)?.openFile(file);
  }

  /** Move a note to trash instead of deleting permanently. */
  async trashNote(file: TFile, context?: DataWriteContext): Promise<void> {
    const credit = this.markOwnedPath(file.path, context?.sourceInstanceId);
    try {
      await this.app.fileManager.trashFile(file);
    } catch (error) {
      this.releaseOwnedCredit(file.path, credit);
      throw error;
    }
  }

  fileExists(path: string): boolean {
    return this.vault.getAbstractFileByPath(path) != null;
  }

  /** Latest observable frontmatter, including short-lived writes not yet reflected in metadataCache. */
  getFrontmatterSnapshot(file: TFile): Record<string, unknown> {
    const cached = this.metadataCache.getFileCache(file)?.frontmatter || {};
    return { ...this.withFrontmatterOverride(file.path, cached) };
  }

  async renameNote(file: TFile, newPath: string, context?: DataWriteContext): Promise<void> {
    const oldCredit = this.markOwnedPath(file.path, context?.sourceInstanceId);
    const newCredit = this.markOwnedPath(newPath, context?.sourceInstanceId);
    try {
      await this.app.fileManager.renameFile(file, newPath);
    } catch (error) {
      this.releaseOwnedCredit(file.path, oldCredit);
      this.releaseOwnedCredit(newPath, newCredit);
      throw error;
    }
  }

  /** Scan all markdown files for view definitions (files with db_view: true in frontmatter) */
  getViewDefFiles(): { file: TFile; config: DatabaseConfig }[] {
    const results: { file: TFile; config: DatabaseConfig }[] = [];
    const allFiles = this.vault.getMarkdownFiles();
    const seedRecordCache = !this.recordCache;
    if (seedRecordCache) this.recordCache = new Map();
    const cleanupTargets: TFile[] = [];
    const idBackfillTargets: { file: TFile; id: string }[] = [];
    const typeFilterTargets: TFile[] = [];

    for (const f of allFiles) {
      const cache = this.metadataCache.getFileCache(f);
      if (seedRecordCache) {
        this.recordCache?.set(f.path, {
          file: f,
          frontmatter: cache?.frontmatter ? cache.frontmatter : {},
        });
      }
      const override = this.getViewDefOverride(f.path);
      if (override) {
        results.push({ file: f, config: override });
        continue;
      }
      const fm = cache?.frontmatter;
      if (!fm || fm["db_view"] !== true) continue;

      const config = this.parseDatabaseConfig(fm);
      if (config) {
        results.push({ file: f, config });
        // Migration: detect legacy top-level "name" field that duplicates database.name
        if (Object.prototype.hasOwnProperty.call(fm, "name")) {
          cleanupTargets.push(f);
        }
        // Migration: backfill a stable database.id when the frontmatter lacks one.
        // parseDatabaseConfig falls back to a fresh temporary id on every scan, which
        // would break dbId-based embed references until the id is persisted to disk.
        const databaseObj = fm["database"] as Record<string, unknown> | undefined;
        if (databaseObj && typeof databaseObj === "object" && databaseObj["id"] == null) {
          idBackfillTargets.push({ file: f, id: config.id });
        }
        // Migration: absorb a legacy `typeFilter` (a special-case filter on the
        // `type` frontmatter field, superseded by general source rules) into the
        // source-rule tree. Done in-memory here so the first scan after upgrade is
        // already correct (avoids a brief window where the filter is lost before the
        // disk write lands); the disk write is persisted asynchronously below.
        if (databaseObj && typeof databaseObj === "object") {
          let typeFilterMigrated = absorbTypeFilterIntoRules(config, databaseObj["typeFilter"]);
          const rawViews = Array.isArray(databaseObj["views"]) ? databaseObj["views"] as Record<string, unknown>[] : [];
          rawViews.forEach((rawView, index) => {
            const viewConfig = config.views[index];
            if (viewConfig && absorbTypeFilterIntoRules(viewConfig, rawView["typeFilter"])) {
              typeFilterMigrated = true;
            }
          });
          if (typeFilterMigrated) typeFilterTargets.push(f);
        }
      }
    }

    const duplicateIdTargets = this.assignUniqueDatabaseIds(results);

    // Asynchronously remove redundant top-level "name" from legacy database files
    if (cleanupTargets.length > 0) {
      void this.migrateRemoveTopLevelName(cleanupTargets);
    }

    // Asynchronously persist a stable id into db_view files missing database.id
    if (idBackfillTargets.length > 0) {
      void this.migrateBackfillDatabaseId(idBackfillTargets);
    }

    // Asynchronously replace duplicated database.id values. This most commonly
    // happens when users duplicate a db_view Markdown file outside the plugin.
    if (duplicateIdTargets.length > 0) {
      void this.migrateDeduplicateDatabaseIds(duplicateIdTargets);
    }

    // Asynchronously absorb legacy typeFilter into source rules and remove it from disk
    if (typeFilterTargets.length > 0) {
      void this.migrateTypeFilterToSourceRules(typeFilterTargets);
    }

    return results;
  }

  private assignUniqueDatabaseIds(results: { file: TFile; config: DatabaseConfig }[]): DatabaseIdDedupTarget[] {
    const byId = new Map<string, { file: TFile; config: DatabaseConfig }[]>();
    for (const entry of results) {
      const id = safeString(entry.config.id);
      if (!id) continue;
      const group = byId.get(id);
      if (group) group.push(entry);
      else byId.set(id, [entry]);
    }

    const targets: DatabaseIdDedupTarget[] = [];
    for (const [id, entries] of byId.entries()) {
      if (entries.length <= 1) continue;
      const sorted = entries.slice().sort(compareDatabaseIdOwners);
      for (const duplicate of sorted.slice(1)) {
        const newId = generateId();
        duplicate.config.id = newId;
        this.rememberViewDefConfig(duplicate.file.path, duplicate.config);
        targets.push({ file: duplicate.file, oldId: id, newId, config: duplicate.config });
      }
    }
    return targets;
  }

  /** Remove the redundant top-level "name" frontmatter field from legacy database files.
   *  The authoritative name is stored inside the "database" object. */
  private async migrateRemoveTopLevelName(files: TFile[]): Promise<void> {
    for (const file of files) {
      try {
        this.markOwnedPath(file.path);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const frontmatter = fm as Record<string, unknown>;
          if (frontmatter["db_view"] === true && Object.prototype.hasOwnProperty.call(frontmatter, "name")) {
            delete frontmatter["name"];
          }
        });
      } catch (err) {
        // Non-critical migration; log and continue
        console.warn("Note Database: failed to migrate top-level name in", file.path, err);
      }
    }
  }

  /** Persist a stable database.id into db_view files whose frontmatter lacks one.
   *  Without a persisted id, parseDatabaseConfig generates a fresh temporary id on every
   *  scan, which would break dbId-based embed references. The id passed in is the one
   *  generated during this scan, so scan and write agree. Idempotent via the null guard. */
  private async migrateBackfillDatabaseId(targets: { file: TFile; id: string }[]): Promise<void> {
    for (const target of targets) {
      try {
        this.markOwnedPath(target.file.path);
        await this.app.fileManager.processFrontMatter(target.file, (fm) => {
          const frontmatter = fm as Record<string, unknown>;
          const database = frontmatter["database"];
          if (frontmatter["db_view"] === true && database && typeof database === "object" && (database as Record<string, unknown>)["id"] == null) {
            (database as Record<string, unknown>)["id"] = target.id;
          }
        });
      } catch (err) {
        // Non-critical migration; log and continue
        console.warn("Note Database: failed to backfill database id in", target.file.path, err);
      }
    }
  }

  /** Replace duplicated database.id values while keeping the oldest file as the
   *  owner of the original id. Copying a db_view Markdown file preserves its
   *  frontmatter id, which breaks dbId-based embedded references unless the copy
   *  receives a fresh id. */
  private async migrateDeduplicateDatabaseIds(targets: DatabaseIdDedupTarget[]): Promise<void> {
    for (const target of targets) {
      try {
        this.markOwnedPath(target.file.path);
        await this.app.fileManager.processFrontMatter(target.file, (fm) => {
          const frontmatter = fm as Record<string, unknown>;
          const database = frontmatter["database"];
          if (
            frontmatter["db_view"] === true &&
            database &&
            typeof database === "object" &&
            (database as Record<string, unknown>)["id"] === target.oldId
          ) {
            (database as Record<string, unknown>)["id"] = target.newId;
          }
        });
      } catch (err) {
        this.viewDefOverrides.delete(target.file.path);
        console.warn("Note Database: failed to deduplicate database id in", target.file.path, err);
      }
    }
  }

  /** Migrate a legacy `typeFilter` (database-level and per-view) into the general
   *  source-rule tree as `{ field: "type", op: "eq" }` and remove `typeFilter` from
   *  disk. typeFilter was a special-case filter on the `type` frontmatter field that
   *  predates source rules. Idempotent via the empty-value guard in
   *  absorbTypeFilterIntoRules, so re-running on an already-migrated file is a no-op.
   *  The in-memory config is migrated synchronously during the scan (see
   *  getViewDefFiles); this persists the same change to the db_view file. */
  private async migrateTypeFilterToSourceRules(files: TFile[]): Promise<void> {
    for (const file of files) {
      try {
        this.markOwnedPath(file.path);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const frontmatter = fm as Record<string, unknown>;
          const database = frontmatter["database"];
          if (frontmatter["db_view"] !== true || !database || typeof database !== "object") return;
          const db = database as Record<string, unknown>;
          absorbTypeFilterIntoRules(db, db["typeFilter"]);
          const views = Array.isArray(db["views"]) ? db["views"] as Record<string, unknown>[] : [];
          for (const view of views) {
            absorbTypeFilterIntoRules(view, view["typeFilter"]);
          }
        });
      } catch (err) {
        // Non-critical migration; log and continue
        console.warn("Note Database: failed to migrate typeFilter in", file.path, err);
      }
    }
  }

  /** Parse DatabaseConfig from a view definition file's frontmatter */
  parseDatabaseConfig(fm: Record<string, unknown>): DatabaseConfig | null {
    try {
      const database = fm["database"] && typeof fm["database"] === "object"
        ? fm["database"] as Record<string, unknown>
        : {};
      const source = { ...fm, ...database };
      const sharedSchema = {
        columns: Array.isArray(source["columns"]) ? source["columns"] as ColumnDef[] : [],
        computedFields: Array.isArray(source["computedFields"]) ? source["computedFields"] as RecordSchema["computedFields"] : [],
      } satisfies RecordSchema;

      // Parse views: new format has database.views array, old format has flat view props
      const viewsArray = database["views"];
      let views: ViewConfig[];

      if (Array.isArray(viewsArray) && viewsArray.length > 0) {
        // New format: views array
        views = viewsArray
          .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v))
          .map((v) => this.parseViewConfig(v, sharedSchema));
      } else {
        // Old format: flat view properties at top level
        const viewType = this.parseViewType(source["viewType"]);
        views = [{
          id: generateId(),
          name: this.getDefaultViewName(viewType),
          viewType,
          sourceFolder: safeString(source["sourceFolder"]),
          sourceRules: Array.isArray(source["sourceRules"]) ? source["sourceRules"] as SourceRule[] : undefined,
          sourceLogic: source["sourceLogic"] === "or" ? "or" : "and",
          sourceRuleTree: parseSourceRuleTree(source["sourceRuleTree"]),
          showRecordIcon: source["showRecordIcon"] === true,
          recordIconFieldOverrideEnabled: source["recordIconFieldOverrideEnabled"] === true,
          recordIconField: safeString(source["recordIconField"]) || undefined,
          newRecordFolder: safeString(source["newRecordFolder"]) || undefined,
          schema: sharedSchema,
          statusPresets: normalizeStatusPresets(source["viewStatusPresets"] || [], []),
          defaultStatusPresetId: safeString(source["viewDefaultStatusPresetId"]) || undefined,
          displayWidth: source["displayWidth"] === "wide" ? "wide" : "default",
          boardGroupField: safeString(source["boardGroupField"]) || undefined,
          boardSubgroupEnabled: this.parseBoardSubgroupEnabled(source),
          boardSubgroupField: safeString(source["boardSubgroupField"]) || undefined,
          boardColumnWidth: typeof source["boardColumnWidth"] === "number" ? source["boardColumnWidth"] : undefined,
          defaultColumnWidth: typeof source["defaultColumnWidth"] === "number" ? source["defaultColumnWidth"] : undefined,
          titleField: safeString(source["titleField"]) || undefined,
          galleryImageField: safeString(source["galleryImageField"]) || undefined,
          galleryImageAspectRatio: typeof source["galleryImageAspectRatio"] === "number" ? source["galleryImageAspectRatio"] : undefined,
          galleryCardSize: typeof source["galleryCardSize"] === "number" ? source["galleryCardSize"] : undefined,
          galleryImageFit: source["galleryImageFit"] === "contain" ? "contain" : source["galleryImageFit"] === "cover" ? "cover" : undefined,
          showEmptyFields: source["showEmptyFields"] === true || (Array.isArray(source["alwaysShowEmptyFields"]) && (source["alwaysShowEmptyFields"] as unknown[]).length > 0),
          listCompactFields: source["listCompactFields"] === true,
          columnOrder: Array.isArray(source["columnOrder"]) ? source["columnOrder"] as string[] : undefined,
          columnWidths: this.parseNumberMap(source["columnWidths"]),
          hiddenColumns: Array.isArray(source["hiddenColumns"]) ? source["hiddenColumns"] as string[] : undefined,
          sortColumnOrder: safeString(source["sortColumnOrder"]) || undefined,
          statusFilter: safeString(source["statusFilter"]) || undefined,
          groupByField: safeString(source["groupByField"]) || undefined,
          groupOrders: source["groupOrders"] && typeof source["groupOrders"] === "object"
            ? source["groupOrders"] as Record<string, string[]>
            : undefined,
          showEmptyGroups: this.parseBooleanMap(source["showEmptyGroups"]),
          collapsedGroups: source["collapsedGroups"] && typeof source["collapsedGroups"] === "object"
            ? source["collapsedGroups"] as Record<string, string[]>
            : undefined,
          boardCardOrders: source["boardCardOrders"] && typeof source["boardCardOrders"] === "object"
            ? source["boardCardOrders"] as Record<string, Record<string, string[]>>
            : undefined,
          manualOrder: source["manualOrder"] && typeof source["manualOrder"] === "object"
            ? source["manualOrder"]
            : undefined,
          filterLogic: source["filterLogic"] === "or" ? "or" : "and",
          filters: Array.isArray(source["filters"]) ? source["filters"] as FilterRule[] : undefined,
          resultLimit: this.parseResultLimit(source["resultLimit"]),
          summaryRules: this.parseSummaryRules(source["summaryRules"]),
          conditionalFormats: this.parseConditionalFormats(source["conditionalFormats"]),
          chartType: this.parseChartType(source["chartType"]),
          chartGroupField: safeString(source["chartGroupField"]) || undefined,
          chartDateBucket: this.parseChartDateBucket(source["chartDateBucket"]),
          chartNumberBucket: this.parseChartNumberBucket(source["chartNumberBucket"]),
          chartNumberBucketSize: this.parsePositiveNumber(source["chartNumberBucketSize"]),
          chartStackField: safeString(source["chartStackField"]) || undefined,
          chartSeriesField: safeString(source["chartSeriesField"] || source["chartStackField"]) || undefined,
          chartAggregation: this.parseChartAggregation(source["chartAggregation"]),
          chartValueField: safeString(source["chartValueField"]) || undefined,
          chartSecondaryAggregation: this.parseChartAggregation(source["chartSecondaryAggregation"]),
          chartSecondaryValueField: safeString(source["chartSecondaryValueField"]) || undefined,
          chartSortBy: this.parseChartSortBy(source["chartSortBy"]),
          chartHiddenGroups: this.parseTrueMap(source["chartHiddenGroups"]),
          chartOmitZeroValues: source["chartOmitZeroValues"] === true,
          chartCumulative: source["chartCumulative"] === true,
          chartHeight: this.parseChartHeight(source["chartHeight"]),
          chartGridLines: this.parseChartGridLines(source["chartGridLines"]),
          chartAxisNames: this.parseChartAxisNames(source["chartAxisNames"]),
          chartShowTitle: source["chartShowTitle"] === false ? false : undefined,
          chartTitle: safeString(source["chartTitle"]) || undefined,
          chartShowDataLabels: source["chartShowDataLabels"] === true,
          chartDataLabelMode: this.parseChartDataLabelMode(source["chartDataLabelMode"]),
          chartDataLabelColor: this.parseChartDataLabelColor(source["chartDataLabelColor"]),
          chartSmoothLine: source["chartSmoothLine"] === true,
          chartGradientArea: source["chartGradientArea"] === true,
          chartShowLegend: source["chartShowLegend"] === false ? false : source["chartShowLegend"] === true ? true : undefined,
          chartColorPalette: this.parseChartColorPalette(source["chartColorPalette"]),
          chartColorByValue: source["chartColorByValue"] === true,
          chartShowDonutCenter: source["chartShowDonutCenter"] === true,
          chartDonutCenterMode: this.parseChartDonutCenterMode(source["chartDonutCenterMode"], source["chartShowDonutCenter"]),
          chartValueAxisRange: this.parseChartValueAxisRange(source["chartValueAxisRange"]),
          chartValueAxisMin: this.parseFiniteNumber(source["chartValueAxisMin"]),
          chartValueAxisMax: this.parseFiniteNumber(source["chartValueAxisMax"]),
          chartReferenceLines: this.parseChartReferenceLines(source["chartReferenceLines"]),
          calendarMonth: this.parseCalendarMonth(source["calendarMonth"]),
          calendarStartDateField: safeString(source["calendarStartDateField"]) || undefined,
          calendarEndDateField: safeString(source["calendarEndDateField"]) || undefined,
          calendarTitleField: safeString(source["calendarTitleField"]) || undefined,
          calendarColorField: safeString(source["calendarColorField"]) || undefined,
          calendarCellMinHeight: this.parsePositiveNumber(source["calendarCellMinHeight"]),
          calendarKeepCellAspectRatio: source["calendarKeepCellAspectRatio"] === true,
          calendarScale: this.parseCalendarScale(source["calendarScale"]),
          calendarDay: this.parseCalendarDay(source["calendarDay"]),
          calendarStartHour: this.parseCalendarHour(source["calendarStartHour"], 0, 23),
          calendarEndHour: this.parseCalendarHour(source["calendarEndHour"], 1, 24),
          calendarHourHeight: this.parsePositiveNumber(source["calendarHourHeight"]),
          calendarWeekSlotDuration: this.parseCalendarSlotDuration(source["calendarWeekSlotDuration"]),
          sortColumn: safeString(source["sortColumn"]) || undefined,
          sortDirection: source["sortDirection"] === "desc" ? "desc" : "asc" as const,
          sortRules: Array.isArray(source["sortRules"]) ? source["sortRules"] as SortRule[] : undefined,
          viewStates: source["viewStates"] && typeof source["viewStates"] === "object"
            ? source["viewStates"]
            : undefined,
        }];
      }
      const legacyConditionalFormats = this.parseConditionalFormats(source["conditionalFormats"]);
      if (legacyConditionalFormats?.length) {
        for (const view of views) {
          if (!view.conditionalFormats?.length) {
            view.conditionalFormats = legacyConditionalFormats.map((rule) => ({
              ...rule,
              condition: { ...rule.condition },
            }));
          }
        }
      }

      return {
        id: database["id"] != null ? safeString(database["id"]) : generateId(),
        name: safeString(source["name"] || fm["name"]),
        icon: safeString(source["icon"]) || undefined,
        coverImage: safeString(source["coverImage"]) || undefined,
        coverImagePositionY: this.parseCoverPosition(source["coverImagePositionY"]),
        description: safeString(source["description"]) || undefined,
        sourceFolder: safeString(source["sourceFolder"]),
        sourceRules: Array.isArray(source["sourceRules"]) ? source["sourceRules"] as SourceRule[] : undefined,
        sourceLogic: source["sourceLogic"] === "or" ? "or" : "and",
        sourceRuleTree: parseSourceRuleTree(source["sourceRuleTree"]),
        newRecordFolder: safeString(source["newRecordFolder"]) || undefined,
        recordIconField: safeString(source["recordIconField"]) || undefined,
        newRecordTemplate: this.parseNewRecordTemplate(source["newRecordTemplate"]),
        computedSyncMode: normalizeComputedSyncMode(source["computedSyncMode"]),
        summaryFormulas: this.parseStringMap(source["summaryFormulas"]),
        schema: sharedSchema,
        statusPresets: normalizeStatusPresets(source["statusPresets"] || [], []),
        defaultStatusPresetId: safeString(source["defaultStatusPresetId"]) || undefined,
        views,
      };
    } catch (e) {
      console.warn("Failed to parse view definition file:", e);
      return null;
    }
  }

  private parseConditionalFormats(value: unknown): ConditionalFormatRule[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const operators = new Set(["eq", "neq", "contains", "hasTag", "gt", "lt", "gte", "lte", "empty", "notempty"]);
    const colors = new Set<string>(OPTION_COLORS);
    const rules: ConditionalFormatRule[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const source = item as Record<string, unknown>;
      const condition = source["condition"];
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) continue;
      const conditionSource = condition as Record<string, unknown>;
      const field = safeString(conditionSource["field"]).trim();
      const op = safeString(conditionSource["op"]);
      const target = source["target"] === "field" ? "field" : source["target"] === "record" ? "record" : null;
      const color = safeString(source["color"]);
      if (!field || !operators.has(op) || !target || !colors.has(color)) continue;
      rules.push({
        id: safeString(source["id"]).trim() || generateId(),
        condition: {
          field,
          op: op as ConditionalFormatRule["condition"]["op"],
          value: safeString(conditionSource["value"]) || undefined,
        },
        valueSource: source["valueSource"] === "today" ? "today" : "literal",
        target,
        color: color as ConditionalFormatRule["color"],
      });
    }
    return rules.length > 0 ? rules : undefined;
  }

  private parseNewRecordTemplate(value: unknown): NewRecordTemplateConfig | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const path = safeString(source["path"]).trim();
    if (!path) return undefined;
    const engine = source["engine"];
    if (engine !== "markdown" && engine !== "core" && engine !== "templater") return undefined;
    return { path, engine };
  }

  private parseCoverPosition(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(100, value));
  }

  private parseViewConfig(v: Record<string, unknown>, sharedSchema: RecordSchema): ViewConfig {
    const parsedSourceRuleTree = parseSourceRuleTree(v["sourceRuleTree"]);
    const hasLegacyViewSourceRules = Array.isArray(v["sourceRules"]) && (v["sourceRules"] as unknown[]).length > 0;
    return {
      id: (v["id"] as string) || generateId(),
      name: safeString(v["name"]) || this.getDefaultViewName(this.parseViewType(v["viewType"])),
      viewType: this.parseViewType(v["viewType"]),
      sourceFolder: safeString(v["sourceFolder"]),
      sourceRules: Array.isArray(v["sourceRules"]) ? v["sourceRules"] as SourceRule[] : undefined,
      sourceLogic: v["sourceLogic"] === "or" ? "or" : "and",
      sourceRuleTree: parsedSourceRuleTree,
      showRecordIcon: v["showRecordIcon"] === true,
      recordIconFieldOverrideEnabled: v["recordIconFieldOverrideEnabled"] === true,
      recordIconField: safeString(v["recordIconField"]) || undefined,
      newRecordFolder: safeString(v["newRecordFolder"]) || undefined,
      schema: sharedSchema,
      statusPresets: normalizeStatusPresets(v["statusPresets"] || [], []),
      defaultStatusPresetId: safeString(v["defaultStatusPresetId"]) || undefined,
      displayWidth: v["displayWidth"] === "wide" ? "wide" : "default",
      boardGroupField: safeString(v["boardGroupField"]) || undefined,
      boardSubgroupEnabled: this.parseBoardSubgroupEnabled(v),
      boardSubgroupField: safeString(v["boardSubgroupField"]) || undefined,
      boardColumnWidth: typeof v["boardColumnWidth"] === "number" ? v["boardColumnWidth"] : undefined,
      defaultColumnWidth: typeof v["defaultColumnWidth"] === "number" ? v["defaultColumnWidth"] : undefined,
      titleField: safeString(v["titleField"]) || undefined,
      galleryImageField: safeString(v["galleryImageField"]) || undefined,
      galleryImageAspectRatio: typeof v["galleryImageAspectRatio"] === "number" ? v["galleryImageAspectRatio"] : undefined,
      galleryCardSize: typeof v["galleryCardSize"] === "number" ? v["galleryCardSize"] : undefined,
      galleryImageFit: v["galleryImageFit"] === "contain" ? "contain" : v["galleryImageFit"] === "cover" ? "cover" : undefined,
      showEmptyFields: v["showEmptyFields"] === true || (Array.isArray(v["alwaysShowEmptyFields"]) && (v["alwaysShowEmptyFields"] as unknown[]).length > 0),
      listCompactFields: v["listCompactFields"] === true,
      columnOrder: Array.isArray(v["columnOrder"]) ? v["columnOrder"] as string[] : undefined,
      columnWidths: this.parseNumberMap(v["columnWidths"]),
      hiddenColumns: Array.isArray(v["hiddenColumns"]) ? v["hiddenColumns"] as string[] : undefined,
      sortColumnOrder: safeString(v["sortColumnOrder"]) || undefined,
      statusFilter: safeString(v["statusFilter"]) || undefined,
      groupByField: safeString(v["groupByField"]) || undefined,
      groupOrders: v["groupOrders"] && typeof v["groupOrders"] === "object"
        ? v["groupOrders"] as Record<string, string[]>
        : undefined,
      showEmptyGroups: this.parseBooleanMap(v["showEmptyGroups"]),
      collapsedGroups: v["collapsedGroups"] && typeof v["collapsedGroups"] === "object"
        ? v["collapsedGroups"] as Record<string, string[]>
        : undefined,
      dateGroupModes: v["dateGroupModes"] && typeof v["dateGroupModes"] === "object"
        ? v["dateGroupModes"] as Record<string, DateGroupMode>
        : undefined,
      groupRowLimit: typeof v["groupRowLimit"] === "number" && v["groupRowLimit"] >= 0
        ? v["groupRowLimit"]
        : undefined,
      expandedGroupRows: v["expandedGroupRows"] && typeof v["expandedGroupRows"] === "object"
        ? v["expandedGroupRows"] as Record<string, Record<string, number>>
        : undefined,
      boardCardOrders: v["boardCardOrders"] && typeof v["boardCardOrders"] === "object"
        ? v["boardCardOrders"] as Record<string, Record<string, string[]>>
        : undefined,
      manualOrder: v["manualOrder"] && typeof v["manualOrder"] === "object"
        ? v["manualOrder"]
        : undefined,
      filterLogic: v["filterLogic"] === "or" ? "or" : "and",
      filters: Array.isArray(v["filters"]) ? v["filters"] as FilterRule[] : undefined,
      resultLimit: this.parseResultLimit(v["resultLimit"]),
      summaryRules: this.parseSummaryRules(v["summaryRules"]),
      conditionalFormats: this.parseConditionalFormats(v["conditionalFormats"]),
      chartType: this.parseChartType(v["chartType"]),
      chartGroupField: safeString(v["chartGroupField"]) || undefined,
      chartDateBucket: this.parseChartDateBucket(v["chartDateBucket"]),
      chartNumberBucket: this.parseChartNumberBucket(v["chartNumberBucket"]),
      chartNumberBucketSize: this.parsePositiveNumber(v["chartNumberBucketSize"]),
      chartStackField: safeString(v["chartStackField"]) || undefined,
      chartSeriesField: safeString(v["chartSeriesField"] || v["chartStackField"]) || undefined,
      chartAggregation: this.parseChartAggregation(v["chartAggregation"]),
      chartValueField: safeString(v["chartValueField"]) || undefined,
      chartSecondaryAggregation: this.parseChartAggregation(v["chartSecondaryAggregation"]),
      chartSecondaryValueField: safeString(v["chartSecondaryValueField"]) || undefined,
      chartSortBy: this.parseChartSortBy(v["chartSortBy"]),
      chartHiddenGroups: this.parseTrueMap(v["chartHiddenGroups"]),
      chartOmitZeroValues: v["chartOmitZeroValues"] === true,
      chartCumulative: v["chartCumulative"] === true,
      chartHeight: this.parseChartHeight(v["chartHeight"]),
      chartGridLines: this.parseChartGridLines(v["chartGridLines"]),
      chartAxisNames: this.parseChartAxisNames(v["chartAxisNames"]),
      chartShowTitle: v["chartShowTitle"] === false ? false : undefined,
      chartTitle: safeString(v["chartTitle"]) || undefined,
      chartShowDataLabels: v["chartShowDataLabels"] === true,
      chartDataLabelMode: this.parseChartDataLabelMode(v["chartDataLabelMode"]),
      chartDataLabelColor: this.parseChartDataLabelColor(v["chartDataLabelColor"]),
      chartSmoothLine: v["chartSmoothLine"] === true,
      chartGradientArea: v["chartGradientArea"] === true,
      chartShowLegend: v["chartShowLegend"] === false ? false : v["chartShowLegend"] === true ? true : undefined,
      chartColorPalette: this.parseChartColorPalette(v["chartColorPalette"]),
      chartColorByValue: v["chartColorByValue"] === true,
      chartShowDonutCenter: v["chartShowDonutCenter"] === true,
      chartDonutCenterMode: this.parseChartDonutCenterMode(v["chartDonutCenterMode"], v["chartShowDonutCenter"]),
      chartValueAxisRange: this.parseChartValueAxisRange(v["chartValueAxisRange"]),
      chartValueAxisMin: this.parseFiniteNumber(v["chartValueAxisMin"]),
      chartValueAxisMax: this.parseFiniteNumber(v["chartValueAxisMax"]),
      chartReferenceLines: this.parseChartReferenceLines(v["chartReferenceLines"]),
      calendarMonth: this.parseCalendarMonth(v["calendarMonth"]),
      calendarStartDateField: safeString(v["calendarStartDateField"]) || undefined,
      calendarEndDateField: safeString(v["calendarEndDateField"]) || undefined,
      calendarTitleField: safeString(v["calendarTitleField"]) || undefined,
      calendarColorField: safeString(v["calendarColorField"]) || undefined,
      calendarCellMinHeight: this.parsePositiveNumber(v["calendarCellMinHeight"]),
      calendarKeepCellAspectRatio: v["calendarKeepCellAspectRatio"] === true,
      calendarScale: this.parseCalendarScale(v["calendarScale"]),
      calendarDay: this.parseCalendarDay(v["calendarDay"]),
      calendarStartHour: this.parseCalendarHour(v["calendarStartHour"], 0, 23),
      calendarEndHour: this.parseCalendarHour(v["calendarEndHour"], 1, 24),
      calendarHourHeight: this.parsePositiveNumber(v["calendarHourHeight"]),
      calendarWeekSlotDuration: this.parseCalendarSlotDuration(v["calendarWeekSlotDuration"]),
      calendarColumnSizeMode: v["calendarColumnSizeMode"] === "custom" ? "custom" : undefined,
      calendarCustomColumnWidth: this.parsePositiveNumber(v["calendarCustomColumnWidth"]),
      calendarRowSizeMode: v["calendarRowSizeMode"] === "custom" ? "custom" : undefined,
      calendarCustomRowHeights: this.parseNumberMap(v["calendarCustomRowHeights"]),
      calendarWeekStart: safeString(v["calendarWeekStart"]) || undefined,
      calendarAllDayMaxLanes: this.parsePositiveNumber(v["calendarAllDayMaxLanes"]),
      calendarFirstDayOfWeek: v["calendarFirstDayOfWeek"] === 0 ? 0 : v["calendarFirstDayOfWeek"] === 1 ? 1 : v["calendarFirstDayOfWeek"] === 6 ? 6 : undefined,
      yearDisplayMode: v["yearDisplayMode"] === "always" ? "always" : v["yearDisplayMode"] === "smart" ? "smart" : v["yearDisplayMode"] === "never" ? "never" : undefined,
      viewSourceRulesEnabled: v["viewSourceRulesEnabled"] === true ? true : v["viewSourceRulesEnabled"] === false ? false : (parsedSourceRuleTree || hasLegacyViewSourceRules) ? true : undefined,
      calendarMonthVisibleLanes: this.parsePositiveNumber(v["calendarMonthVisibleLanes"]),
      timelineStartDateField: safeString(v["timelineStartDateField"]) || undefined,
      timelineEndDateField: safeString(v["timelineEndDateField"]) || undefined,
      timelineGroupField: safeString(v["timelineGroupField"]) || undefined,
      timelineTitleField: safeString(v["timelineTitleField"]) || undefined,
      timelineColorField: safeString(v["timelineColorField"]) || undefined,
      timelineScale: this.parseTimelineScale(v["timelineScale"]),
      timelineAnchor: safeString(v["timelineAnchor"]) || undefined,
      timelineAnchorTimeMinutes: this.parseCalendarMinute(v["timelineAnchorTimeMinutes"]),
      timelineColumnSizeMode: v["timelineColumnSizeMode"] === "custom" ? "custom" : undefined,
      timelineCustomUnitWidth: typeof v["timelineCustomUnitWidth"] === "number" ? v["timelineCustomUnitWidth"] : undefined,
      sortColumn: safeString(v["sortColumn"]) || undefined,
      sortDirection: v["sortDirection"] === "desc" ? "desc" : "asc" as const,
      sortRules: Array.isArray(v["sortRules"]) ? v["sortRules"] as SortRule[] : undefined,
      viewStates: v["viewStates"] && typeof v["viewStates"] === "object"
        ? v["viewStates"]
        : undefined,
    };
  }

  /** Write database config changes back to a view definition file.
   *  Serialized per-file to prevent conflicts with concurrent frontmatter writes. */
  async updateViewDefFile(file: TFile, dbConfig: DatabaseConfig, mutation?: ViewConfigMutation): Promise<void> {
    return this.enqueueWrite(file.path, async () => {
      this.rememberViewDefConfig(file.path, dbConfig);
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const f = fm as Record<string, unknown>;
          f["db_view"] = true;
          // name is stored inside the database object; avoid a redundant top-level name
          // that would show up in Obsidian's property panel.
          delete f["name"];
          f["database"] = this.toDatabasePayload(dbConfig);
          for (const key of this.legacyViewKeys()) delete f[key];
        });
      } catch (err) {
        this.viewDefOverrides.delete(file.path);
        throw err;
      }
      if (mutation) this.notifyViewConfigChanged({ ...mutation, database: dbConfig });
    }, { sourceInstanceId: mutation?.sourceInstanceId });
  }

  async createViewDefFile(folderPath: string, filename: string, dbConfig: DatabaseConfig): Promise<TFile> {
    const frontmatter = {
      db_view: true,
      // name is stored inside the database object; avoid a redundant top-level name
      // that would show up in Obsidian's property panel.
      database: this.toDatabasePayload(dbConfig),
    };
    const yaml = stringifyYaml(frontmatter).trim();
    const folder = this.normalizeVaultFolder(folderPath);
    await this.ensureFolder(folder);
    const safeFilename = filename.replace(/[\\/]/g, "-").trim() || "Untitled";
    const withExtension = safeFilename.endsWith(".md") ? safeFilename : `${safeFilename}.md`;
    const path = this.getAvailablePath(normalizePath(folder ? `${folder}/${withExtension}` : withExtension));
    this.markOwnedPath(path);
    const file = await this.vault.create(path, `---\n${yaml}\n---\n\n`);
    if (this.recordCache) {
      this.recordCache.set(file.path, {
        file,
        frontmatter: {
          db_view: true,
          database: this.toDatabasePayload(dbConfig),
        },
      });
    }
    // Cache the config so getViewDefFiles can read it before the metadata cache indexes the new file
    this.rememberViewDefConfig(file.path, dbConfig);
    return file;
  }

  private toDatabasePayload(dbConfig: DatabaseConfig): Record<string, unknown> {
    return {
      id: dbConfig.id,
      name: dbConfig.name || "",
      icon: dbConfig.icon || "",
      coverImage: dbConfig.coverImage || "",
      coverImagePositionY: dbConfig.coverImagePositionY ?? 50,
      description: dbConfig.description || "",
      sourceFolder: dbConfig.sourceFolder || "",
      sourceRules: dbConfig.sourceRules || [],
      sourceLogic: dbConfig.sourceLogic || "and",
      sourceRuleTree: dbConfig.sourceRuleTree,
      newRecordFolder: dbConfig.newRecordFolder || "",
      recordIconField: dbConfig.recordIconField || "",
      newRecordTemplate: dbConfig.newRecordTemplate,
      computedSyncMode: normalizeComputedSyncMode(dbConfig.computedSyncMode),
      summaryFormulas: dbConfig.summaryFormulas || {},
      columns: dbConfig.schema.columns || [],
      computedFields: dbConfig.schema.computedFields || [],
      statusPresets: dbConfig.statusPresets || [],
      defaultStatusPresetId: dbConfig.defaultStatusPresetId || "",
      views: dbConfig.views.map((v) => this.toViewPayload(v)),
    };
  }

  private toViewPayload(view: ViewConfig): Record<string, unknown> {
    return {
      id: view.id || "",
      name: view.name || "",
      viewType: view.viewType || "table",
      sourceFolder: view.sourceFolder || "",
      sourceRules: view.sourceRules || [],
      sourceLogic: view.sourceLogic || "and",
      sourceRuleTree: view.sourceRuleTree,
      showRecordIcon: view.showRecordIcon === true,
      recordIconFieldOverrideEnabled: view.recordIconFieldOverrideEnabled === true,
      recordIconField: view.recordIconField || "",
      newRecordFolder: view.newRecordFolder || "",
      displayWidth: view.displayWidth || "default",
      sortColumn: view.sortColumn || "",
      sortDirection: view.sortDirection || "asc",
      sortRules: view.sortRules || [],
      columnOrder: view.columnOrder || [],
      columnWidths: view.columnWidths || {},
      hiddenColumns: view.hiddenColumns || [],
      sortColumnOrder: view.sortColumnOrder || "",
      statusFilter: view.statusFilter || "",
      groupByField: view.groupByField || "",
      groupOrders: view.groupOrders || {},
      showEmptyGroups: view.showEmptyGroups || {},
      collapsedGroups: view.collapsedGroups || {},
      dateGroupModes: view.dateGroupModes,
      groupRowLimit: view.groupRowLimit,
      expandedGroupRows: view.expandedGroupRows,
      boardGroupField: view.boardGroupField || "",
      boardSubgroupEnabled: view.boardSubgroupEnabled ?? Boolean(view.boardSubgroupField),
      boardSubgroupField: view.boardSubgroupField || "",
      boardColumnWidth: view.boardColumnWidth || 280,
      defaultColumnWidth: view.defaultColumnWidth || 150,
      titleField: view.titleField || "",
      boardCardOrders: view.boardCardOrders || {},
      manualOrder: view.manualOrder && view.manualOrder.ranks && Object.keys(view.manualOrder.ranks).length > 0
        ? view.manualOrder
        : undefined,
      galleryImageField: view.galleryImageField || "",
      galleryImageAspectRatio: view.galleryImageAspectRatio || 0.75,
      galleryCardSize: view.galleryCardSize || 250,
      galleryImageFit: view.galleryImageFit || "cover",
      showEmptyFields: view.showEmptyFields === true,
      listCompactFields: view.listCompactFields === true,
      statusPresets: view.statusPresets || [],
      defaultStatusPresetId: view.defaultStatusPresetId || "",
      filterLogic: view.filterLogic || "and",
      filters: view.filters || [],
      resultLimit: view.resultLimit,
      summaryRules: view.summaryRules || [],
      conditionalFormats: view.conditionalFormats || [],
      chartType: view.chartType || "bar",
      chartGroupField: view.chartGroupField || "",
      chartDateBucket: view.chartDateBucket || "",
      chartNumberBucket: view.chartNumberBucket || "",
      chartNumberBucketSize: view.chartNumberBucketSize,
      chartStackField: view.chartStackField || "",
      chartSeriesField: view.chartSeriesField || view.chartStackField || "",
      chartAggregation: view.chartAggregation || "count",
      chartValueField: view.chartValueField || "",
      chartSecondaryAggregation: view.chartSecondaryAggregation || "count",
      chartSecondaryValueField: view.chartSecondaryValueField || "",
      chartSortBy: view.chartSortBy || "",
      chartHiddenGroups: view.chartHiddenGroups || {},
      chartOmitZeroValues: view.chartOmitZeroValues === true,
      chartCumulative: view.chartCumulative === true,
      chartHeight: view.chartHeight || "",
      chartGridLines: view.chartGridLines || "",
      chartAxisNames: view.chartAxisNames || "",
      chartShowTitle: view.chartShowTitle === false ? false : true,
      chartTitle: view.chartTitle || "",
      chartShowDataLabels: view.chartShowDataLabels === true,
      chartDataLabelMode: view.chartDataLabelMode || "",
      chartDataLabelColor: view.chartDataLabelColor || "",
      chartSmoothLine: view.chartSmoothLine === true,
      chartGradientArea: view.chartGradientArea === true,
      chartShowLegend: view.chartShowLegend === false ? false : view.chartShowLegend === true ? true : undefined,
      chartColorPalette: view.chartColorPalette || "",
      chartColorByValue: view.chartColorByValue === true,
      chartShowDonutCenter: view.chartShowDonutCenter === true,
      chartDonutCenterMode: view.chartDonutCenterMode || "",
      chartValueAxisRange: view.chartValueAxisRange || "",
      chartValueAxisMin: view.chartValueAxisMin,
      chartValueAxisMax: view.chartValueAxisMax,
      chartReferenceLines: view.chartReferenceLines || [],
      calendarMonth: view.calendarMonth || "",
      calendarStartDateField: view.calendarStartDateField || "",
      calendarEndDateField: view.calendarEndDateField || "",
      calendarTitleField: view.calendarTitleField || "",
      calendarColorField: view.calendarColorField || "",
      calendarCellMinHeight: view.calendarCellMinHeight || undefined,
      calendarKeepCellAspectRatio: view.calendarKeepCellAspectRatio === true,
      calendarScale: view.calendarScale || "",
      calendarDay: view.calendarDay || "",
      calendarStartHour: view.calendarStartHour,
      calendarEndHour: view.calendarEndHour,
      calendarHourHeight: view.calendarHourHeight,
      calendarWeekSlotDuration: view.calendarWeekSlotDuration,
      calendarColumnSizeMode: view.calendarColumnSizeMode === "custom" ? "custom" : undefined,
      calendarCustomColumnWidth: typeof view.calendarCustomColumnWidth === "number" ? view.calendarCustomColumnWidth : undefined,
      calendarRowSizeMode: view.calendarRowSizeMode === "custom" ? "custom" : undefined,
      calendarCustomRowHeights: view.calendarCustomRowHeights && typeof view.calendarCustomRowHeights === "object" ? view.calendarCustomRowHeights : undefined,
      calendarWeekStart: view.calendarWeekStart || "",
      calendarAllDayMaxLanes: typeof view.calendarAllDayMaxLanes === "number" ? view.calendarAllDayMaxLanes : undefined,
      calendarFirstDayOfWeek: view.calendarFirstDayOfWeek === 0 || view.calendarFirstDayOfWeek === 1 || view.calendarFirstDayOfWeek === 6 ? view.calendarFirstDayOfWeek : undefined,
      yearDisplayMode: view.yearDisplayMode === "always" || view.yearDisplayMode === "smart" || view.yearDisplayMode === "never" ? view.yearDisplayMode : undefined,
      viewSourceRulesEnabled: typeof view.viewSourceRulesEnabled === "boolean" ? view.viewSourceRulesEnabled : undefined,
      calendarMonthVisibleLanes: typeof view.calendarMonthVisibleLanes === "number" ? view.calendarMonthVisibleLanes : undefined,
      timelineStartDateField: view.timelineStartDateField || "",
      timelineEndDateField: view.timelineEndDateField || "",
      timelineGroupField: view.timelineGroupField || "",
      timelineTitleField: view.timelineTitleField || "",
      timelineColorField: view.timelineColorField || "",
      timelineScale: view.timelineScale || "",
      timelineAnchor: view.timelineAnchor || "",
      timelineAnchorTimeMinutes: view.timelineAnchorTimeMinutes,
      timelineColumnSizeMode: view.timelineColumnSizeMode || "",
      timelineCustomUnitWidth: typeof view.timelineCustomUnitWidth === "number" ? view.timelineCustomUnitWidth : undefined,
      viewStates: view.viewStates || {},
    };
  }

  private legacyViewKeys(): string[] {
    return [
      "sourceFolder",
      "sourceRules",
      "sourceLogic",
      "sourceRuleTree",
      "newRecordFolder",
      "computedSyncMode",
      "summaryFormulas",
      "columns",
      "computedFields",
      "sortColumn",
      "sortDirection",
      "sortRules",
      "viewStatusPresets",
      "viewDefaultStatusPresetId",
      "viewType",
      "displayWidth",
      "boardGroupField",
      "boardSubgroupEnabled",
      "boardSubgroupField",
      "boardColumnWidth",
      "defaultColumnWidth",
      "titleField",
      "galleryImageField",
      "galleryImageAspectRatio",
      "galleryCardSize",
      "galleryImageFit",
      "alwaysShowEmptyFields",
      "showEmptyFields",
      "listCompactFields",
      "columnOrder",
      "columnWidths",
      "hiddenColumns",
      "sortColumnOrder",
      "statusFilter",
      // searchText is no longer persisted (search is transient); kept here only
      // to strip it from legacy flat-format frontmatter on the next write.
      "searchText",
      "groupByField",
      "groupOrders",
      "showEmptyGroups",
      "collapsedGroups",
      "boardCardOrders",
      "filterLogic",
      "filters",
      "resultLimit",
      "summaryRules",
      "conditionalFormats",
      "chartType",
      "chartGroupField",
      "chartDateBucket",
      "chartNumberBucket",
      "chartNumberBucketSize",
      "chartStackField",
      "chartSeriesField",
      "chartAggregation",
      "chartValueField",
      "chartSecondaryAggregation",
      "chartSecondaryValueField",
      "chartSortBy",
      "chartHiddenGroups",
      "chartOmitZeroValues",
      "chartCumulative",
      "chartHeight",
      "chartGridLines",
      "chartAxisNames",
      "chartShowTitle",
      "chartTitle",
      "chartShowDataLabels",
      "chartDataLabelMode",
      "chartSmoothLine",
      "chartGradientArea",
      "chartShowLegend",
      "chartColorPalette",
      "chartColorByValue",
      "chartShowDonutCenter",
      "chartDonutCenterMode",
      "chartValueAxisRange",
      "chartValueAxisMin",
      "chartValueAxisMax",
      "chartReferenceLines",
      "calendarMonth",
      "calendarStartDateField",
      "calendarEndDateField",
      "calendarTitleField",
      "calendarColorField",
      "calendarCellMinHeight",
      "calendarKeepCellAspectRatio",
      "calendarScale",
      "calendarDay",
      "calendarStartHour",
      "calendarEndHour",
      "calendarHourHeight",
      "calendarWeekSlotDuration",
      "timelineStartDateField",
      "timelineEndDateField",
      "timelineGroupField",
      "timelineTitleField",
      "timelineColorField",
      "timelineScale",
      "timelineAnchor",
      "timelineAnchorTimeMinutes",
      "timelineColumnSizeMode",
      "timelineCustomUnitWidth",
      "viewStates",
    ];
  }

  private parseResultLimit(value: unknown): number | undefined {
    const limit = typeof value === "number" ? value : Number(value);
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
  }

  private parsePositiveNumber(value: unknown): number | undefined {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  private parseFiniteNumber(value: unknown): number | undefined {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  private parseStringMap(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key.trim() && item != null)
      .map(([key, item]) => [key, String(item)] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private parseSummaryRules(value: unknown): NonNullable<ViewConfig["summaryRules"]> | undefined {
    if (Array.isArray(value)) {
      const rules = value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const source = entry as Record<string, unknown>;
        const field = safeString(source["field"]).trim();
        const summary = safeString(source["summary"]).trim();
        return field && summary ? [{ field, summary }] : [];
      });
      return rules.length > 0 ? rules : undefined;
    }
    const legacy = this.parseStringMap(value);
    if (!legacy) return undefined;
    const rules = Object.entries(legacy)
      .filter(([field, summary]) => field.trim() && summary.trim())
      .map(([field, summary]) => ({ field, summary }));
    return rules.length > 0 ? rules : undefined;
  }

  private parseNumberMap(value: unknown): Record<string, number> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key.trim(), Number(item)] as const)
      .filter(([key, item]) => key && Number.isFinite(item) && item > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private parseTrueMap(value: unknown): Record<string, true> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key.trim() && item === true)
      .map(([key]) => [key, true] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private parseBooleanMap(value: unknown): Record<string, boolean> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key.trim() && typeof item === "boolean")
      .map(([key, item]) => [key, item as boolean] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private parseBoardSubgroupEnabled(value: Record<string, unknown>): boolean | undefined {
    if (typeof value["boardSubgroupEnabled"] === "boolean") return value["boardSubgroupEnabled"];
    return safeString(value["boardSubgroupField"]) ? true : undefined;
  }

  private parseViewType(value: unknown): ViewConfig["viewType"] {
    if (value === "board" || value === "gallery" || value === "list" || value === "chart" || value === "calendar" || value === "timeline") return value;
    return "table";
  }

  private parseChartAggregation(value: unknown): ViewConfig["chartAggregation"] {
    if (
      value === "sum" ||
      value === "avg" ||
      value === "median" ||
      value === "min" ||
      value === "max" ||
      value === "range" ||
      value === "unique" ||
      value === "empty" ||
      value === "not-empty" ||
      value === "percent-empty" ||
      value === "percent-not-empty" ||
      value === "checked" ||
      value === "unchecked" ||
      value === "percent-checked"
    ) return value;
    if (value === "count") return "count";
    return undefined;
  }

  private parseChartType(value: unknown): ViewConfig["chartType"] {
    if (
      value === "bar" ||
      value === "horizontal-bar" ||
      value === "line" ||
      value === "area" ||
      value === "pie" ||
      value === "donut" ||
      value === "number" ||
      value === "stacked-bar" ||
      value === "grouped-bar" ||
      value === "percent-stacked-bar" ||
      value === "mixed"
    ) {
      return value;
    }
    return undefined;
  }

  private parseChartDateBucket(value: unknown): ViewConfig["chartDateBucket"] {
    if (value === "day" || value === "week" || value === "month" || value === "quarter" || value === "year") return value;
    return undefined;
  }

  private parseChartNumberBucket(value: unknown): ViewConfig["chartNumberBucket"] {
    if (value === "auto" || value === "fixed") return value;
    return undefined;
  }

  private parseChartSortBy(value: unknown): ViewConfig["chartSortBy"] {
    if (value === "value-desc" || value === "value-asc" || value === "label-asc" || value === "label-desc" || value === "option-order") return value;
    return undefined;
  }

  private parseChartHeight(value: unknown): ViewConfig["chartHeight"] {
    if (value === "small" || value === "medium" || value === "large" || value === "xlarge") return value;
    return undefined;
  }

  private parseChartGridLines(value: unknown): ViewConfig["chartGridLines"] {
    if (value === "none" || value === "value" || value === "both") return value;
    return undefined;
  }

  private parseChartAxisNames(value: unknown): ViewConfig["chartAxisNames"] {
    if (value === "none" || value === "x" || value === "y" || value === "both") return value;
    return undefined;
  }

  private parseChartDataLabelMode(value: unknown): ViewConfig["chartDataLabelMode"] {
    if (value === "value" || value === "percent" || value === "label-value") return value;
    return undefined;
  }

  private parseChartDataLabelColor(value: unknown): ViewConfig["chartDataLabelColor"] {
    if (value === "auto" || value === "dark" || value === "light" || value === "accent") return value;
    return undefined;
  }

  private parseChartColorPalette(value: unknown): ViewConfig["chartColorPalette"] {
    if (
      value === "auto" ||
      value === "accent" ||
      value === "colorful" ||
      value === "pastel" ||
      value === "vivid" ||
      value === "warm" ||
      value === "cool" ||
      value === "mono" ||
      value === "option"
    ) return value;
    return undefined;
  }

  private parseChartDonutCenterMode(value: unknown, legacyVisible: unknown): ViewConfig["chartDonutCenterMode"] {
    if (value === "hidden" || value === "total" || value === "aggregation") return value;
    return legacyVisible === true ? "total" : undefined;
  }

  private parseChartValueAxisRange(value: unknown): ViewConfig["chartValueAxisRange"] {
    if (value === "auto" || value === "zero-based" || value === "custom") return value;
    return undefined;
  }

  private parseTimelineScale(value: unknown): ViewConfig["timelineScale"] {
    if (value === "day" || value === "week" || value === "month" || value === "quarter") return value;
    return undefined;
  }

  private parseCalendarScale(value: unknown): ViewConfig["calendarScale"] {
    if (value === "month" || value === "week" || value === "day") return value;
    return undefined;
  }

  private parseCalendarDay(value: unknown): string | undefined {
    const text = safeString(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  }

  private parseCalendarHour(value: unknown, min: number, max: number): number | undefined {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return undefined;
    const hour = Math.round(n);
    return hour >= min && hour <= max ? hour : undefined;
  }

  private parseCalendarMinute(value: unknown): number | undefined {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return undefined;
    const minute = Math.round(n);
    return minute >= 0 && minute < 1440 ? minute : undefined;
  }

  private parseCalendarSlotDuration(value: unknown): ViewConfig["calendarWeekSlotDuration"] {
    const n = typeof value === "number" ? value : Number(value);
    return n === 15 || n === 30 || n === 60 ? n : undefined;
  }

  private parseChartReferenceLines(value: unknown): ChartReferenceLine[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const lines = value
      .map((item, index) => this.parseChartReferenceLine(item, index))
      .filter((line): line is ChartReferenceLine => Boolean(line));
    return lines.length > 0 ? lines : undefined;
  }

  private parseChartReferenceLine(value: unknown, index: number): ChartReferenceLine | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const type = source["type"];
    if (type !== "constant" && type !== "average" && type !== "median" && type !== "min" && type !== "max") return undefined;
    const numericValue = this.parseFiniteNumber(source["value"]);
    if (type === "constant" && numericValue == null) return undefined;
    const style = source["style"] === "dashed" || source["style"] === "dotted" ? source["style"] : "solid";
    return {
      id: safeString(source["id"]) || `line-${index + 1}`,
      type,
      value: numericValue,
      label: safeString(source["label"]) || undefined,
      color: safeString(source["color"]) || undefined,
      style,
    };
  }

  private parseCalendarMonth(value: unknown): string | undefined {
    const text = safeString(value);
    return /^\d{4}-\d{2}$/.test(text) ? text : undefined;
  }

  private getDefaultViewName(viewType: ViewConfig["viewType"]): string {
    if (viewType === "board") return t("common.boardView");
    if (viewType === "gallery") return t("common.galleryView");
    if (viewType === "list") return t("common.listView");
    if (viewType === "chart") return t("common.chartView");
    if (viewType === "calendar") return t("common.calendarView");
    if (viewType === "timeline") return t("common.timelineView");
    return t("common.tableView");
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!folderPath) return;
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        await this.vault.createFolder(current);
      }
    }
  }

  /** Treat empty or "/" as the vault root and keep stored paths vault-relative. */
  private normalizeVaultFolder(folderPath: string): string {
    const normalized = normalizePath(folderPath || "");
    return normalized === "/" ? "" : normalized.replace(/^\/+/, "");
  }

  private toRawRecord(file: TFile): NoteRecord {
    const cache = this.metadataCache.getFileCache(file);
    return {
      file,
      frontmatter: cache?.frontmatter ? cache.frontmatter : {},
    };
  }

  private getCachedRecords(): NoteRecord[] {
    if (!this.recordCache) {
      this.recordCache = new Map(
        this.vault.getMarkdownFiles().map((file) => [file.path, this.toRawRecord(file)])
      );
    }
    this.cleanupFrontmatterOverrides();
    return Array.from(this.recordCache.values(), (record) => this.applyFrontmatterOverride(record));
  }

  private refreshCachedRecord(file: unknown): void {
    if (!this.recordCache || !(file instanceof TFile)) return;
    if (file.extension !== "md") {
      this.recordCache.delete(file.path);
      return;
    }
    this.recordCache.set(file.path, this.toRawRecord(file));
  }

  /**
   * Vault.modify can arrive before MetadataCache.changed. Usually the latter
   * refreshes the snapshot, but external tools and sync providers occasionally
   * fail to produce that hand-off. Re-read only that file after a grace period;
   * the normal metadata event cancels this fallback.
   */
  private scheduleModifyRecheck(file: unknown): void {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    this.cancelModifyRecheck(file.path);
    const timer = window.setTimeout(() => {
      this.modifyRecheckTimers.delete(file.path);
      void this.reconcileModifiedRecordFromDisk(file);
    }, 500);
    this.modifyRecheckTimers.set(file.path, timer);
  }

  private cancelModifyRecheck(path: string): void {
    const timer = this.modifyRecheckTimers.get(path);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.modifyRecheckTimers.delete(path);
  }

  private async reconcileModifiedRecordFromDisk(file: TFile): Promise<void> {
    try {
      const content = await this.vault.read(file);
      const match = content.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      let frontmatter: Record<string, unknown> = {};
      if (match) {
        const parsed: unknown = parseYaml(match[1]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          frontmatter = parsed as Record<string, unknown>;
        }
      }
      if (this.recordCache) this.recordCache.set(file.path, { file, frontmatter });
      this.frontmatterOverrides.delete(file.path);
      this.viewDefOverrides.delete(file.path);
      // This path only runs when the authoritative metadata event did not
      // arrive. Treat the recovery conservatively as external without
      // consuming ownership credits reserved for real Obsidian events.
      this.queuePendingChange({
        kind: "changed",
        path: file.path,
        origin: "external",
      });
    } catch (error) {
      console.warn("Note Database: failed to reconcile modified record", file.path, error);
    }
  }

  private applyFrontmatterOverride(record: NoteRecord): NoteRecord {
    const override = this.frontmatterOverrides.get(record.file.path);
    if (!override) return record;
    return {
      file: record.file,
      frontmatter: this.mergeFrontmatterOverride(record.frontmatter, override.values),
    };
  }

  private rememberFrontmatterUpdates(path: string, updates: Record<string, unknown>): void {
    this.cleanupFrontmatterOverrides();
    const existing = this.frontmatterOverrides.get(path)?.values || {};
    const combined = { ...existing, ...updates };
    const file = this.vault.getAbstractFileByPath(path);
    const cached = file instanceof TFile
      ? this.metadataCache.getFileCache(file)?.frontmatter || {}
      : {};
    const pending: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(combined)) {
      const cachedHas = Object.prototype.hasOwnProperty.call(cached, key);
      const caughtUp = value === null
        ? !cachedHas
        : cachedHas && this.valuesEqual(cached[key], value);
      if (!caughtUp) pending[key] = value;
    }
    if (Object.keys(pending).length === 0) {
      this.frontmatterOverrides.delete(path);
      return;
    }
    this.frontmatterOverrides.set(path, {
      values: pending,
      expiresAt: Date.now() + 10000,
    });
  }

  private diffFrontmatter(
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): Record<string, unknown> {
    // Track only changed top-level keys so metadata overlays mirror Obsidian's frontmatter shape.
    const updates: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const beforeHas = Object.prototype.hasOwnProperty.call(before, key);
      const afterHas = Object.prototype.hasOwnProperty.call(after, key);
      if (!afterHas) {
        if (beforeHas) updates[key] = null;
        continue;
      }
      if (!beforeHas || !this.valuesEqual(before[key], after[key])) {
        updates[key] = this.cloneFrontmatterValue(after[key]);
      }
    }
    return updates;
  }

  private cloneFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
    // Snapshot before mutation so in-place array/object edits can still be compared reliably.
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      clone[key] = this.cloneFrontmatterValue(value);
    }
    return clone;
  }

  private cloneFrontmatterValue(value: unknown): unknown {
    // Frontmatter values are YAML-compatible; JSON cloning is enough for nested arrays/objects here.
    if (Array.isArray(value)) return value.map((entry) => this.cloneFrontmatterValue(entry));
    if (value && typeof value === "object") {
      const serialized = JSON.stringify(value);
      return serialized == null ? value : JSON.parse(serialized);
    }
    return value;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    // Normalize nullish scalars while comparing structured values by content.
    if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === "object") || (b && typeof b === "object")) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return (a ?? null) === (b ?? null);
  }

  private withFrontmatterOverride(path: string, frontmatter: Record<string, unknown>): Record<string, unknown> {
    this.cleanupFrontmatterOverrides();
    const override = this.frontmatterOverrides.get(path);
    if (!override) return frontmatter;
    return this.mergeFrontmatterOverride(frontmatter, override.values);
  }

  private mergeFrontmatterOverride(
    frontmatter: Record<string, unknown>,
    values: Record<string, unknown>
  ): Record<string, unknown> {
    const merged = { ...frontmatter };
    for (const [key, value] of Object.entries(values)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    return merged;
  }

  private cleanupFrontmatterOverrides(): void {
    const now = Date.now();
    for (const [path, override] of this.frontmatterOverrides) {
      if (override.expiresAt <= now) this.frontmatterOverrides.delete(path);
    }
  }

  private rememberViewDefConfig(path: string, config: DatabaseConfig): void {
    this.cleanupViewDefOverrides();
    const cloned = this.cloneDatabaseConfig(config);
    linkDatabaseSchema(cloned);
    this.viewDefOverrides.set(path, {
      config: cloned,
      expiresAt: Date.now() + 10000,
    });
  }

  private getViewDefOverride(path: string): DatabaseConfig | null {
    this.cleanupViewDefOverrides();
    const override = this.viewDefOverrides.get(path);
    if (!override) return null;
    const cloned = this.cloneDatabaseConfig(override.config);
    linkDatabaseSchema(cloned);
    return cloned;
  }

  private cleanupViewDefOverrides(): void {
    const now = Date.now();
    for (const [path, override] of this.viewDefOverrides) {
      if (override.expiresAt <= now) this.viewDefOverrides.delete(path);
    }
  }

  private cloneDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
    return JSON.parse(JSON.stringify(config)) as DatabaseConfig;
  }

  private matchesSourceRule(record: NoteRecord, rule: SourceRule, db: DatabaseConfig): boolean {
    const value = this.getSourceFieldValue(record, rule.field, db);
    const expected = String(rule.value ?? "");
    const columns = db.schema.columns;
    switch (rule.op) {
      case "inFolder":
        return this.isInFolder(record.file, expected);
      case "hasTag":
        return hasObsidianTagValue(this.getTags(record), expected);
      case "hasProperty":
        return Object.prototype.hasOwnProperty.call(record.frontmatter, rule.field);
      case "hasLink":
        return fileHasLink(this.app, record.file, expected, this.metadataCache.getFileCache(record.file));
      case "eq":
        return baseSourceValuesEqual(value, rule, columns);
      case "neq":
        return !baseSourceValuesEqual(value, rule, columns);
      case "strictEq":
        return sourceRuleValuesStrictEqual(value, rule);
      case "strictNeq":
        return !sourceRuleValuesStrictEqual(value, rule);
      case "contains":
        return sourceRuleContainsValue(value, rule);
      case "startsWith":
        return matchesStringSourceRuleValue(value, (text) => text.startsWith(expected));
      case "endsWith":
        return matchesStringSourceRuleValue(value, (text) => text.endsWith(expected));
      case "matches": {
        const regex = parseSourceRuleRegex(expected);
        return regex ? matchesStringSourceRuleValue(value, (text) => {
          regex.lastIndex = 0;
          return regex.test(text);
        }) : false;
      }
      case "isType":
        return matchesBaseSourceType(value, expected, rule.field, columns, db.schema.computedFields);
      case "gt":
        return compareSourceRuleValue(value, rule, columns, (result) => result > 0);
      case "gte":
        return compareSourceRuleValue(value, rule, columns, (result) => result >= 0);
      case "lt":
        return compareSourceRuleValue(value, rule, columns, (result) => result < 0);
      case "lte":
        return compareSourceRuleValue(value, rule, columns, (result) => result <= 0);
      case "empty":
        return isBaseSourceEmptyValue(value);
      case "notempty":
        return !isBaseSourceEmptyValue(value);
      case "truthy":
        return Boolean(value);
      default:
        return true;
    }
  }

  private matchesSourceExpression(record: NoteRecord, expression: string, db: DatabaseConfig): boolean {
    try {
      const thisFile = this.getBaseThisFile(db);
      const thisFrontmatter = thisFile
        ? this.metadataCache.getFileCache(thisFile)?.frontmatter
        : undefined;
      return evaluateBaseFilterExpression(expression, {
        app: this.app,
        file: record.file,
        frontmatter: record.frontmatter,
        thisFile,
        thisFrontmatter,
        computedFields: db.schema.computedFields,
        columns: db.schema.columns,
      });
    } catch (error) {
      console.warn("Note Database: failed to evaluate Bases source expression", expression, error);
      return false;
    }
  }

  private getBaseThisFile(db: DatabaseConfig): TFile | undefined {
    if (!db.baseThisFilePath) return undefined;
    const file = this.vault.getAbstractFileByPath(db.baseThisFilePath);
    return file instanceof TFile ? file : undefined;
  }

  private getSourceFieldValue(record: NoteRecord, field: string, db?: DatabaseConfig): unknown {
    if (field.startsWith("formula.")) {
      const key = field.slice("formula.".length);
      if (!db?.schema.computedFields?.some((computed) => computed.key === key)) return undefined;
      const thisFile = this.getBaseThisFile(db);
      const thisFrontmatter = thisFile
        ? this.metadataCache.getFileCache(thisFile)?.frontmatter
        : undefined;
      return evaluateComputedFields(db.schema.computedFields, db.schema.columns, record.frontmatter, {
        app: this.app,
        file: record.file,
        thisFile,
        thisFrontmatter,
      })[key];
    }
    if (isBaseFileField(field)) {
      return getFileFieldValue(
        record.file,
        field,
        record.frontmatter,
        this.metadataCache.getFileCache(record.file),
        this.app
      );
    }
    if (field === "folder") return record.file.parent?.path || "";
    if (field === "tags") return this.getTags(record).join(" ");
    // aliases is a built-in multitext list: return it as an array so source-rule contains/eq
    // use list semantics (any-element) instead of substring on a raw comma string.
    if (field === "aliases") return toMultiSelectValues(record.frontmatter[field]);
    return record.frontmatter[field];
  }

  private isInFolder(file: TFile, folder: string): boolean {
    const normalized = this.normalizeVaultFolder(folder);
    if (!normalized) return true;
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    return file.path.startsWith(prefix);
  }

  private getTags(record: NoteRecord): string[] {
    const cache = this.metadataCache.getFileCache(record.file);
    return toObsidianTagValues([
      ...toObsidianTagValues(record.frontmatter["tags"]),
      ...(cache ? getAllTags(cache) || [] : []),
    ]);
  }

  private getAvailablePath(path: string): string {
    if (!this.vault.getAbstractFileByPath(path)) return path;
    const dot = path.lastIndexOf(".");
    const base = dot >= 0 ? path.substring(0, dot) : path;
    const ext = dot >= 0 ? path.substring(dot) : "";
    let i = 1;
    let candidate = `${base} ${i}${ext}`;
    while (this.vault.getAbstractFileByPath(candidate)) {
      i += 1;
      candidate = `${base} ${i}${ext}`;
    }
    return candidate;
  }

  /** Debounce rapid file events into a single identity-preserving batch. */
  private scheduleNotify(
    kind: DataChangeKind,
    path: string,
    oldPath: string | undefined,
    signal: DataChangeSignal
  ): void {
    // Consume both sides of a rename. Short-circuiting here would leave the old
    // path's vault credit alive and could hide an external file recreated at
    // that path a moment later.
    const ownedPath = this.consumeOwnedPath(path, signal);
    const ownedOldPath = oldPath ? this.consumeOwnedPath(oldPath, signal) : null;
    const origin: DataChangeOrigin = ownedPath || ownedOldPath
      ? "plugin"
      : "external";
    const ownedSources = [ownedPath?.sourceInstanceId, ownedOldPath?.sourceInstanceId]
      .filter((value): value is string => Boolean(value));
    const sourceInstanceId = origin === "plugin" &&
      ownedSources.length > 0 &&
      ownedSources.every((value) => value === ownedSources[0])
      ? ownedSources[0]
      : undefined;
    this.queuePendingChange({
      kind,
      path,
      oldPath,
      origin,
      sourceInstanceId,
    });
  }

  private queuePendingChange(change: DataChange): void {
    const { kind, path, oldPath, origin, sourceInstanceId } = change;
    const key = kind === "renamed" ? `${kind}:${oldPath || ""}:${path}` : `${kind}:${path}`;
    const existing = this.pendingChanges.get(key);
    // When Vault and metadata signals for the same path collapse into one
    // debounce window, never let a later plugin-owned signal overwrite an
    // already observed external save. A redundant refresh is safer than
    // silently losing the user's newer data.
    const mergedOrigin = existing?.origin === "external" || origin === "external"
      ? "external"
      : "plugin";
    const mergedSourceInstanceId = mergedOrigin === "plugin" &&
      existing?.sourceInstanceId &&
      sourceInstanceId &&
      existing.sourceInstanceId === sourceInstanceId
      ? sourceInstanceId
      : existing
        ? undefined
        : sourceInstanceId;
    this.pendingChanges.set(key, {
      kind,
      path,
      oldPath,
      origin: mergedOrigin,
      sourceInstanceId: mergedSourceInstanceId,
    });
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, 80);
  }

  private notify(): void {
    const batch = { changes: Array.from(this.pendingChanges.values()) };
    this.pendingChanges.clear();
    for (const cb of this.listeners) {
      cb(batch);
    }
  }

  private markOwnedPath(path: string, sourceInstanceId?: string): OwnedWriteCredit {
    this.ownedPathUntil ??= new Map();
    const current = this.ownedPathUntil.get(path);
    const credit = {
      expiresAt: Date.now() + 5_000,
      sourceInstanceId,
    };
    this.ownedPathUntil.set(path, {
      // A normal Obsidian write emits one Vault event and one metadata-cache
      // event. Keep separate credits so a missing metadata event cannot consume
      // the user's next external Vault save (or vice versa).
      metadataEvents: [...(current?.metadataEvents || []), credit],
      vaultEvents: [...(current?.vaultEvents || []), credit],
    });
    return credit;
  }

  private releaseOwnedCredit(path: string, credit: OwnedWriteCredit): void {
    const ownership = this.ownedPathUntil.get(path);
    if (!ownership) return;
    ownership.metadataEvents = ownership.metadataEvents.filter((candidate) => candidate !== credit);
    ownership.vaultEvents = ownership.vaultEvents.filter((candidate) => candidate !== credit);
    if (ownership.metadataEvents.length === 0 && ownership.vaultEvents.length === 0) {
      this.ownedPathUntil.delete(path);
    }
  }

  private consumeOwnedPath(path: string, signal: DataChangeSignal): OwnedWriteCredit | null {
    this.ownedPathUntil ??= new Map();
    const now = Date.now();
    for (const [candidate, state] of this.ownedPathUntil) {
      state.metadataEvents = state.metadataEvents.filter((credit) => credit.expiresAt >= now);
      state.vaultEvents = state.vaultEvents.filter((credit) => credit.expiresAt >= now);
      if (state.metadataEvents.length === 0 && state.vaultEvents.length === 0) {
        this.ownedPathUntil.delete(candidate);
      }
    }
    const ownership = this.ownedPathUntil.get(path);
    if (!ownership) return null;
    const key = signal === "metadata" ? "metadataEvents" : "vaultEvents";
    const credit = ownership[key].shift();
    if (!credit) return null;
    if (ownership.metadataEvents.length === 0 && ownership.vaultEvents.length === 0) {
      this.ownedPathUntil.delete(path);
    }
    return credit;
  }
}

function isBaseSourceEmptyValue(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Date) return !Number.isFinite(value.getTime());
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function baseSourceValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
  // Multi-value fields (aliases, multi-select) follow the same list semantics as
  // Bases/QueryEngine filters: any element equal to the rule value counts as a match.
  // neq is the caller's negation (!baseSourceValuesEqual), which then correctly means
  // "no element equals". See ARCHITECTURE_CONTRACTS.md (source-rule eq/contains).
  if (Array.isArray(value)) return value.some((item) => baseSourceScalarValuesEqual(item, rule, columns));
  return baseSourceScalarValuesEqual(value, rule, columns);
}

function baseSourceScalarValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
  const expected = String(rule.value ?? "");
  if (shouldCompareSourceRuleAsDate(rule, columns)) {
    const leftDate = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(safeString(value));
    const rightDate = Date.parse(expected);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate === rightDate;
  }
  if (rule.valueType) return sourceRuleValuesLooseEqual(value, rule);
  return safeString(value) === expected;
}

function shouldCompareSourceRuleAsDate(rule: SourceRule, columns?: ColumnDef[]): boolean {
  if (rule.valueType === "date") return true;
  return isBaseFileField(rule.field) && getBaseFileFieldType(rule.field) === "date";
}

function matchesStringSourceRuleValue(value: unknown, predicate: (text: string) => boolean): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => {
    if (item == null) return false;
    const text = String(item);
    return text.length <= MAX_SOURCE_RULE_MATCH_TEXT_LENGTH && predicate(text);
  });
}

function parseSourceRuleRegex(expected: string): RegExp | undefined {
  const literal = expected.match(/^\/((?:\\.|[^/\\\n])*)\/([a-z]*)$/);
  try {
    return literal ? new RegExp(literal[1], literal[2]) : new RegExp(expected);
  } catch {
    return undefined;
  }
}

function compareSourceRuleValue(value: unknown, rule: SourceRule, columns: ColumnDef[] | undefined, predicate: (result: number) => boolean): boolean {
  const expected = String(rule.value ?? "");
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => {
    if (item == null || item === "") return false;
    return predicate(compareScalarSourceRuleValue(item, expected, shouldCompareSourceRuleAsDate(rule, columns)));
  });
}

function compareScalarSourceRuleValue(value: unknown, expected: string, preferDate: boolean): number {
  if (preferDate) {
    const leftDate = value instanceof Date ? value.getTime() : Date.parse(safeString(value));
    const rightDate = Date.parse(expected);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  }
  const leftNumber = typeof value === "number" ? value : Number(value);
  const rightNumber = Number(expected);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const rightDate = Date.parse(expected);
  const leftDate = value instanceof Date
    ? value.getTime()
    : typeof value === "number" && Number.isFinite(rightDate)
      ? value
      : Date.parse(safeString(value));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  return safeString(value).localeCompare(expected);
}
