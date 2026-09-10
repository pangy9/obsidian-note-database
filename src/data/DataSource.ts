import { TFile, Vault, MetadataCache, App, Notice, normalizePath, parseYaml, stringifyYaml, EventRef, getAllTags } from "obsidian";
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
import { cloneFrontmatter, cloneFrontmatterValue, diffFrontmatter } from "./FrontmatterOverride";
import { applyFrontmatterWrites, applyViewDefDatabasePatch, configsDeepEqual, mergeFrontmatterDesired, reconcileFrontmatterDesired, verifyFrontmatterExpect } from "./FrontmatterPatch";
import { resolveRenamedRecordCache } from "./RecordCacheResolution";
import { PathTaskQueue } from "./PathTaskQueue";
import { parseDiskFrontmatter, runBoundedReconcilePool, runDiskReconcileTask, type DiskReconcileTaskDeps, type DiskReconcileOutcome } from "./DiskReconcile";
import { ReconcileScheduler } from "./ReconcileScheduler";
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "./RenameTransaction";
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
  assertWritable?: () => void;
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

export interface ViewDefSnapshot {
  typedConfig: DatabaseConfig;
  rawPayload: unknown;
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
  private pendingChanges = new Map<string, DataChange>();
  private ownedPathUntil = new Map<string, {
    metadataEvents: OwnedWriteCredit[];
    vaultEvents: OwnedWriteCredit[];
  }>();
  private recordCache: Map<string, NoteRecord> | null = null;
  private frontmatterOverrides = new Map<string, { values: Record<string, FrontmatterKeySnapshot>; expiresAt: number }>();
  private viewDefOverrides = new Map<string, { config: DatabaseConfig; rawPayload: unknown; expiresAt: number }>();
  /** Per-file write queue to serialize processFrontMatter calls on the same file */
  /** 读写共用的路径任务队列（写入在 enqueueWrite 内另行包装 ownership；读取零副作用）。 */
  private pathTasks = new PathTaskQueue();
  /** 每路径插件写入版本：成功写入 +1。磁盘对账用它识别"读取期间有新写入"（过期读取）。 */
  private pathWriteVersions = new Map<string, number>();
  /** 对账作用域代数：destroy() 推进，使在途任务不得发布缓存/清 overlay/广播。 */
  private reconcileEpoch = 0;
  /** 永久卸载标志：队列中的滞后任务即使捕获到新 epoch 也不得发布（epoch 可复用，标志不会）。 */
  private dataSourceDestroyed = false;
  /** 每路径身份代数：删除/重命名时推进。同路径重建（新 TFile 实例）使在途读取的发布权限失效。 */
  private pathGenerations = new Map<string, number>();
  /** 磁盘对账最终失败的路径：cleanup（读驱动）不再重复调度；新的磁盘证据（modify/metadata）到来后重置。 */
  private reconcileFailedPaths = new Set<string>();
  /** overlay 过期告警去重（每路径一次，避免读驱动 cleanup 反复打日志）。 */
  private overlayExpiryWarned = new Set<string>();
  /** 磁盘对账调度：去重 + 有界退避 + 删除/重命名/卸载失效。 */
  private reconcileScheduler = new ReconcileScheduler({
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (timer) => window.clearTimeout(timer),
    runReconcile: (path) => this.runDiskReconcile(path),
    onFinalFailure: (path) => {
      // 登记失败门控：读驱动的 cleanup 不再对该路径反复调度（避免无限重试）；
      // modify/metadata/手动刷新等新证据会清除门控重新调度。
      this.reconcileFailedPaths.add(path);
      console.error(`Note Database: disk reconcile failed after retries for ${path}`);
      new Notice(t("errors.refreshFailed"));
    },
    onScheduleError: (path, error) => {
      console.warn(`Note Database: disk reconcile error for ${path}`, error);
    },
  });

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
    return this.pathTasks.enqueue(path, async () => {
      context?.assertWritable?.();
      const credit = this.markOwnedPath(path, context?.sourceInstanceId);
      try {
        await operation();
      } catch (error) {
        this.releaseOwnedCredit(path, credit);
        throw error;
      }
    });
  }

  /**
   * 与写入共用同一路径队列但不标记写入 ownership：读取/对账任务不得产生
   * "插件写入"标记，否则会把随后的外部变化误过滤为自身回声。
   * 队列只串行化本插件任务，不构成磁盘原子锁——任务内部自行复验。
   */
  private enqueueReadTask(path: string, task: () => Promise<void>): Promise<void> {
    return this.pathTasks.enqueue(path, task);
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
    // 隔离 listener 异常：配置可能已落盘（patchViewDefConfig post-commit），listener 抛错
    // 不得让 writer reject（否则违反 resolve=已落盘/reject=未写入 契约，executor 无法补偿）。
    for (const cb of this.viewConfigListeners) {
      try {
        cb(mutation);
      } catch (error) {
        console.error("Note Database: view config listener threw (mutation already applied)", error);
      }
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
      // 不能无条件删 overlay：延迟到达的旧 commit 事件会误删较新的 compensation overlay
      // （commit cost → compensate price → compensation overlay 已记 → 旧 commit 事件到达 →
      // 若直接 delete 会回到 cost）。只在 cache 确实追平期望状态时移除对应 key/条目。
      this.reconcileFrontmatterOverride(file);
      this.reconcileViewDefOverride(file);
      // 事件处理后仍有待对账状态（overlay 未追平 / view-def 未交接）→ 不能就此罢手，
      // 保留磁盘对账兜底：磁盘即真相，最终由它完成交接或让外部修改接管。
      if (this.frontmatterOverrides.has(file.path) || this.viewDefOverrides.has(file.path)) {
        this.reconcileScheduler.schedule(file.path);
      }
      const beforeBase = this.recordCache?.get(file.path)?.frontmatter;
      this.refreshCachedRecord(file);
      const afterBase = this.recordCache?.get(file.path)?.frontmatter;
      // 晚到的旧 metadata 事件可能覆盖已提交/已对账的正确快照，且此刻已无 overlay
      // 保护。基底被事件改变且无 overlay 时，交给磁盘仲裁（而不是无条件信任事件）。
      if (beforeBase && afterBase && JSON.stringify(beforeBase) !== JSON.stringify(afterBase)
        && !this.frontmatterOverrides.has(file.path)) {
        this.reconcileFailedPaths.delete(file.path);
        this.reconcileScheduler.schedule(file.path);
      }
      this.scheduleNotify("changed", file.path, undefined, "metadata");
    }));
    track(this.vault.on("modify", (file) => {
      this.scheduleNotify("changed", file.path, undefined, "vault");
      // 附件（图片/PDF 等）修改不触发全文对账；只有 Markdown 笔记才调度。
      if (!(file instanceof TFile) || file.extension !== "md") return;
      // 新的磁盘证据到达：此前最终失败的对账路径重新获得调度资格。
      this.reconcileFailedPaths.delete(file.path);
      this.overlayExpiryWarned.delete(file.path);
      this.reconcileScheduler.schedule(file.path);
    }));
    track(this.vault.on("create", (file) => {
      this.refreshCachedRecord(file);
      this.scheduleNotify("created", file.path, undefined, "vault");
    }));
    track(this.vault.on("delete", (file) => {
      this.recordCache?.delete(file.path);
      this.reconcileScheduler.invalidate(file.path);
      // 同路径重建会产生新 TFile 实例：推进代数使在途读取（基于旧实例捕获）失去发布权限。
      this.bumpPathGeneration(file.path);
      this.scheduleNotify("deleted", file.path, undefined, "vault");
    }));
    track(this.vault.on("rename", (file, oldPath) => {
      // rename 不改变文件内容：旧路径记录即权威值，传给 refreshCachedRecord——
      // metadataCache 尚未解析新路径（cache null 或 frontmatter undefined）时
      // 立即迁移，避免重命名后的行首帧整行清空、要等兜底才恢复。
      const previousRecord = this.recordCache?.get(oldPath);
      this.recordCache?.delete(oldPath);
      this.reconcileScheduler.invalidate(oldPath);
      this.bumpPathGeneration(oldPath);
      this.refreshCachedRecord(file, previousRecord?.frontmatter);
      // Bug 5: 迁移 optimistic overrides old→new（不清除，否则丢掉等待 metadata cache 接管
      // 的 frontmatter——新创建文件被快速重命名时尤其关键）。
      const fmOverride = this.frontmatterOverrides.get(oldPath);
      if (fmOverride) {
        this.frontmatterOverrides.delete(oldPath);
        this.frontmatterOverrides.set(file.path, fmOverride);
      }
      const vdOverride = this.viewDefOverrides.get(oldPath);
      if (vdOverride) {
        this.viewDefOverrides.delete(oldPath);
        this.viewDefOverrides.set(file.path, vdOverride);
      }
      this.scheduleNotify("renamed", file.path, oldPath, "vault");
    }));
  }

  /** Unregister all events — call from plugin onunload() */
  destroy(): void {
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    // 卸载后旧对账任务（计时/执行中/退避重试/队列中滞后任务）全部失效，不得再写缓存或广播。
    // epoch 会被后续创建复用，dataSourceDestroyed 是永久的第二道闸。
    this.dataSourceDestroyed = true;
    this.reconcileEpoch += 1;
    this.reconcileScheduler.destroy();
    this.pathTasks.clear();
    for (const ref of this.eventRefs) {
      ref.offref();
    }
    this.eventRefs = [];
    this.listeners = [];
    this.viewConfigListeners = [];
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
      // 写回调内捕获完成后的独立快照：持久化成功后发布为 recordCache 基础值
      //（无差异写入同样修复旧缓存），失败则绝不发布。
      let after: Record<string, unknown> | null = null;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          context?.assertWritable?.();
          const frontmatter = fm as Record<string, unknown>;
          const before = cloneFrontmatter(frontmatter);
          mutator(frontmatter);
          updates = diffFrontmatter(before, frontmatter);
          after = cloneFrontmatter(frontmatter);
        });
        try {
          if (after) this.publishCommittedSnapshot(file.path, after);
          if (updates && Object.keys(updates).length > 0) {
            this.rememberFrontmatterUpdates(file.path, updates);
          }
        } catch (hookError) {
          // 文件已写入：缓存钩子异常不得误报为"文件未写入"。
          console.error("Note Database: post-write cache hook failed (file already persisted)", hookError);
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
        frontmatter: cloneFrontmatter(frontmatter),
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
    // 权威来源统一：recordCache 持有提交快照（写成功发布）与磁盘对账结果，优先于
    // metadataCache——否则磁盘恢复/写后窗口的编辑仍会读到旧值。
    const base = this.recordCache?.get(file.path)?.frontmatter
      ?? this.metadataCache.getFileCache(file)?.frontmatter
      ?? {};
    // 深克隆（浅展开不足以隔离 Obsidian 共享的值数组）；编辑器读此快照后即使
    // 原地修改也不会渗透回 metadataCache。
    return cloneFrontmatter(this.withFrontmatterOverride(file.path, base));
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
          // 同 toRawRecord：克隆以隔离 Obsidian 的共享 frontmatter 对象。
          frontmatter: cache?.frontmatter ? cloneFrontmatter(cache.frontmatter) : {},
        });
      }
      const override = this.getViewDefOverride(f.path);
      if (override) {
        results.push({ file: f, config: override });
        continue;
      }
      // 权威来源统一：非种子路径优先读 recordCache（提交快照/磁盘对账结果），
      // metadataCache 只作回退——磁盘恢复后配置不再被旧 metadata 覆盖。
      const fm = this.recordCache?.get(f.path)?.frontmatter ?? cache?.frontmatter;
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
          boardImageField: safeString(source["boardImageField"]) || undefined,
          boardImageAspectRatio: typeof source["boardImageAspectRatio"] === "number" ? source["boardImageAspectRatio"] : undefined,
          boardImageFit: source["boardImageFit"] === "contain" ? "contain" : source["boardImageFit"] === "cover" ? "cover" : undefined,
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

  /**
   * 从磁盘同一份 view-def frontmatter 同时读取 typed config 与 raw database payload。
   * rename prepare 必须使用同源快照：typed 用于构建 after，raw 用于后续 CAS，不能把
   * live/metadata typed config 与另一时刻的 raw payload 拼接。
   */
  async readViewDefSnapshot(path: string): Promise<ViewDefSnapshot> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error(`readViewDefSnapshot: view-def not found: ${path}`);
    }
    const frontmatter = await this.readFrontmatterFromDisk(file);
    if (frontmatter["db_view"] !== true) {
      throw new Error(`readViewDefSnapshot: not a view-def file: ${path}`);
    }
    const typedConfig = this.parseDatabaseConfig(frontmatter);
    if (!typedConfig) throw new Error(`readViewDefSnapshot: invalid database config: ${path}`);
    return {
      typedConfig: this.cloneDatabaseConfig(typedConfig),
      rawPayload: cloneFrontmatterValue(frontmatter["database"]),
    };
  }

  /** 从磁盘读取 rename 涉及 key 的存在性/值快照；不依赖 metadata cache/overlay。 */
  async readFrontmatterKeySnapshots(
    path: string,
    keys: readonly string[]
  ): Promise<Record<string, FrontmatterKeySnapshot>> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error(`readFrontmatterKeySnapshots: note not found: ${path}`);
    }
    const frontmatter = await this.readFrontmatterFromDisk(file);
    const snapshots: Record<string, FrontmatterKeySnapshot> = {};
    for (const key of keys) {
      snapshots[key] = Object.prototype.hasOwnProperty.call(frontmatter, key)
        ? { exists: true, value: cloneFrontmatterValue(frontmatter[key]) }
        : { exists: false };
    }
    return snapshots;
  }

  private async readFrontmatterFromDisk(file: TFile): Promise<Record<string, unknown>> {
    const content = await this.vault.read(file);
    const match = content.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return {};
    const parsed: unknown = parseYaml(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
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
      boardImageField: safeString(v["boardImageField"]) || undefined,
      boardImageAspectRatio: typeof v["boardImageAspectRatio"] === "number" ? v["boardImageAspectRatio"] : undefined,
      boardImageFit: v["boardImageFit"] === "contain" ? "contain" : v["boardImageFit"] === "cover" ? "cover" : undefined,
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
        const payload = this.toDatabasePayload(dbConfig);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          applyViewDefDatabasePatch(fm as Record<string, unknown>, payload, this.legacyViewKeys());
        });
      } catch (err) {
        this.viewDefOverrides.delete(file.path);
        throw err;
      }
      if (mutation) this.notifyViewConfigChanged({ ...mutation, database: dbConfig });
    }, { sourceInstanceId: mutation?.sourceInstanceId });
  }

  /**
   * 原子 read-modify-write 笔记 frontmatter（R2-CO-1 writer）。
   * 在 processFrontMatter 回调（Obsidian 写锁）内：校验涉及 key 仍符合 expect，
   * 通过则 apply writes（set/delete）；任一不符抛 conflict（回调抛错 → 不落盘）。
   * resolve = 已落盘；reject（含 conflict）= 该步骤未写入。同 path 经 enqueueWrite 串行。
   */
  async patchFrontmatter(
    path: string,
    expect: Record<string, FrontmatterKeySnapshot>,
    writes: Record<string, FrontmatterWrite>,
    assertWritable?: () => void
  ): Promise<void> {
    // 克隆排队参数，避免等待队列期间调用方修改 plan 对象
    const expectSnapshot: Record<string, FrontmatterKeySnapshot> = {};
    for (const [k, s] of Object.entries(expect)) {
      expectSnapshot[k] = s.exists ? { exists: true, value: cloneFrontmatterValue(s.value) } : { exists: false };
    }
    const writesSnapshot: Record<string, FrontmatterWrite> = {};
    for (const [k, op] of Object.entries(writes)) {
      writesSnapshot[k] = op.kind === "delete" ? { kind: "delete" } : { kind: "set", value: cloneFrontmatterValue(op.value) };
    }
    return this.enqueueWrite(path, async () => {
      // 排队期间文件可能被删除/重命名，进入队列后重新解析 TFile
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        throw new Error(`patchFrontmatter: note not found: ${path}`);
      }
      // 写回调内捕获完成后的独立快照：持久化成功后发布为 recordCache 基础值。
      let after: Record<string, unknown> | null = null;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const frontmatter = fm as Record<string, unknown>;
        assertWritable?.();
        const verify = verifyFrontmatterExpect(frontmatter, expectSnapshot);
        if (!verify.ok) {
          throw new Error(`frontmatter conflict: ${path}: ${verify.key} (${verify.reason})`);
        }
        applyFrontmatterWrites(frontmatter, writesSnapshot);
        after = cloneFrontmatter(frontmatter);
      });
      // 写入已成功：post-commit hook 失败不得让 writer reject（否则违反 resolve=已落盘/reject=未写入 契约）。
      try {
        if (after) this.publishCommittedSnapshot(path, after);
        const desired: Record<string, FrontmatterKeySnapshot> = {};
        for (const [key, op] of Object.entries(writesSnapshot)) {
          desired[key] = op.kind === "delete" ? { exists: false } : { exists: true, value: op.value };
        }
        this.rememberFrontmatterDesired(path, desired);
      } catch (hookErr) {
        console.error("Note Database: frontmatter overlay hook failed (already persisted)", hookErr);
      }
    }, { assertWritable });
  }

  /**
   * 原子 CAS 写 view-def 配置（R2-CO-1 writer，config 并发保护）。
   * casExpect/casNext 是 raw database payload（与文件 fm.database 比较，不用 toDatabasePayload
   * 以免补默认值与旧格式误冲突）；typedNext（typed config）用于持久化成功后的 optimistic
   * override 与 peer notify。resolve = 已落盘；reject = 未写入。同 path 经 enqueueWrite 串行。
   */
  async patchViewDefConfig(
    path: string,
    casExpect: unknown,
    casNext: unknown,
    typedNext?: DatabaseConfig,
    mutation?: ViewConfigMutation,
    assertWritable?: () => void
  ): Promise<void> {
    // 克隆 raw payload，避免等待队列期间调用方修改
    const expectPayload = cloneFrontmatterValue(casExpect);
    const nextPayload = cloneFrontmatterValue(casNext);
    const typedNextSnapshot = typedNext ? this.cloneDatabaseConfig(typedNext) : undefined;
    const mutationSnapshot = mutation ? { ...mutation } : undefined;
    return this.enqueueWrite(path, async () => {
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        throw new Error(`patchViewDefConfig: view-def not found: ${path}`);
      }
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const f = fm as Record<string, unknown>;
        assertWritable?.();
        if (!configsDeepEqual(f["database"], expectPayload)) {
          throw new Error(`config conflict: ${path}`);
        }
        // 事务 config patch 只改 database：不夹带 db_view/name/legacy 格式迁移，
        // 否则 commit 删了顶层 name/legacy、compensate 只恢复 database → name/legacy 永久丢失。
        f["database"] = nextPayload;
      });
      // 写入已成功：post-commit hook 失败不得让 writer reject（同 patchFrontmatter）。
      // 推进写入版本：使在途的磁盘对账读取作废，保护更新中的配置 overlay。
      this.pathWriteVersions.set(path, (this.pathWriteVersions.get(path) || 0) + 1);
      if (typedNextSnapshot) {
        try {
          // reconcile 必须等待本次实际写入的 raw casNext，而不是从 typed config
          // 再序列化；补偿旧格式 payload 时二者可能不同。
          this.rememberViewDefConfig(path, typedNextSnapshot, nextPayload);
        } catch (hookErr) {
          console.error("Note Database: view-def override hook failed (already persisted)", hookErr);
        }
      }
      if (typedNextSnapshot && mutationSnapshot) {
        try {
          this.notifyViewConfigChanged({ ...mutationSnapshot, database: typedNextSnapshot });
        } catch (hookErr) {
          console.error("Note Database: view-def peer notify hook failed (already persisted)", hookErr);
        }
      }
    }, { sourceInstanceId: mutationSnapshot?.sourceInstanceId, assertWritable });
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

  /** 公开纯序列化：typed config → raw database payload（深拷贝，不绑 private toDatabasePayload）。
   *  R2-CO-1 plan builder 的 deps.serializeConfig 注入此方法生成 casAfter。 */
  serializeDatabaseConfig(config: DatabaseConfig): unknown {
    return cloneFrontmatterValue(this.toDatabasePayload(config));
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
      boardImageField: view.boardImageField || "",
      boardImageAspectRatio: view.boardImageAspectRatio || 0.75,
      boardImageFit: view.boardImageFit || "cover",
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
      "boardImageField",
      "boardImageAspectRatio",
      "boardImageFit",
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
      // 必须克隆：Obsidian metadataCache 对内容相同的文件返回同一个共享 frontmatter
      // 对象（multi-select 值数组同样共享）。直接持有引用会让任何下游原地修改污染
      // Obsidian 缓存本身——共享该对象的其他文件渲染出脏值且任何刷新都无法恢复。
      frontmatter: cache?.frontmatter ? cloneFrontmatter(cache.frontmatter) : {},
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

  private refreshCachedRecord(file: unknown, previousFrontmatter?: Record<string, unknown>): void {
    if (!this.recordCache || !(file instanceof TFile)) return;
    if (file.extension !== "md") {
      this.recordCache.delete(file.path);
      return;
    }
    // metadataCache 未就绪有两种形态：getFileCache → null，或返回缓存对象但
    // frontmatter === undefined。两者都交给 resolveRenamedRecordCache 统一决策：
    // rename 场景传入旧路径记录（内容未变，即权威值）立即迁移，消除首帧清空；
    // 未就绪一律安排 modifyRecheck 磁盘重读兜底（权威事件先到会取消）。
    const cache = this.metadataCache.getFileCache(file);
    const resolution = resolveRenamedRecordCache(cache?.frontmatter, previousFrontmatter);
    this.recordCache.set(file.path, { file, frontmatter: cloneFrontmatter(resolution.frontmatter ?? {}) });
    if (resolution.needsRecheck) this.scheduleModifyRecheck(file);
  }

  /**
   * Vault.modify can arrive before MetadataCache.changed. Usually the latter
   * refreshes the snapshot, but external tools and sync providers occasionally
   * fail to produce that hand-off. Re-read only that file after a grace period;
   * the normal metadata event cancels this fallback.
   */
  private scheduleModifyRecheck(file: unknown): void {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    this.reconcileScheduler.schedule(file.path);
  }

  /**
   * 有效来源范围的候选笔记路径。不按 sourceRules 过滤——规则依赖属性值，
   * 不能用可能过期的缓存筛选"需要刷新哪些文件"，否则会漏掉刚进入来源范围的笔记。
   */
  getSourceCandidatePaths(db: DatabaseConfig): string[] {
    const folder = this.normalizeVaultFolder(db.sourceFolder || "");
    const prefix = folder ? (folder.endsWith("/") ? folder : `${folder}/`) : "";
    return this.vault.getMarkdownFiles()
      .filter((file) => !prefix || file.path.startsWith(prefix))
      .map((file) => file.path);
  }

  /**
   * 手动刷新的统一恢复入口：批量从磁盘对账给定路径（有界并发、去重），
   * 返回成功数与失败路径。与后台调度互不干扰（各路径仍经串行队列）。
   */
  async reconcilePathsFromDisk(
    paths: Iterable<string>,
    opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
  ): Promise<{ succeeded: number; failed: string[] }> {
    const valid: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      const file = this.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && file.extension === "md") valid.push(path);
    }
    // 手动刷新是新的磁盘证据：清除失败门控，被兜底暂停的路径重新对账。
    for (const path of paths) this.reconcileFailedPaths.delete(path);
    // 缓存为空（手动刷新先 invalidate）时先从 metadata 全量种子：磁盘快照发布到
    // 非空缓存才会被保存；种子保证"读取成功=恢复成功"，且其他记录不缺失、
    // 候选路径的磁盘真值随后覆盖对应条目。
    if (!this.recordCache) this.getCachedRecords();
    return runBoundedReconcilePool(valid, (path) => this.runDiskReconcile(path), opts);
  }

  /**
   * 执行一次磁盘对账（由 ReconcileScheduler 调度）。返回 true=已发布（含文件
   * 无效的静默放弃），false=应按退避重试（stale 或异常）。解析失败 throw 由
   * 调度器记录并计入退避——保留原缓存，绝不当作空 frontmatter。
   */
  private async runDiskReconcile(path: string): Promise<boolean> {
    // publishSnapshot 只写非空缓存：后台触发（overlay 过期/modify）时缓存可能尚未
    // 种子。先确保存在，否则磁盘读取结果会被整体丢弃。
    if (!this.recordCache) this.getCachedRecords();
    // 非 Markdown（附件等）不读全文；调度侧已过滤，这里是执行侧的第二道闸。
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return true;
    // 生命周期与身份必须在【入队前】捕获：排队期间卸载/删除重建时，任务开始执行才
    // 捕获会拿到卸载后的新 epoch/新实例而通过校验。epoch 可能复用，dataSourceDestroyed
    // 永久；同路径重建用 TFile 实例 + 路径代数双重识别。
    const scopeEpoch = this.reconcileEpoch;
    const scopeGeneration = this.pathGenerations.get(path) || 0;
    const scopeFile: TFile = file;
    const deps = this.diskReconcileDeps(scopeFile, scopeEpoch, scopeGeneration);
    let outcome: DiskReconcileOutcome | undefined;
    // 与同路径插件写入串行（PathTaskQueue），读取不标记 ownership。
    await this.enqueueReadTask(path, async () => {
      outcome = await runDiskReconcileTask(deps, path);
    });
    return outcome?.outcome !== "stale";
  }

  private diskReconcileDeps(scopeFile: TFile, scopeEpoch: number, scopeGeneration: number): DiskReconcileTaskDeps {
    return {
      // 三重校验：未卸载（永久标志）+ epoch 未推进 + 路径代数未推进（删除/重建/改名）。
      isScopeValid: () =>
        !this.dataSourceDestroyed &&
        this.reconcileEpoch === scopeEpoch &&
        (this.pathGenerations.get(scopeFile.path) || 0) === scopeGeneration,
      readFile: (p) => this.vault.adapter.read(p),
      parse: (content) => parseDiskFrontmatter(content, parseYaml),
      clone: (frontmatter) => cloneFrontmatter(frontmatter),
      // 文件身份 = TFile 实例同一性：删除后同路径重建（即使 mtime/size 巧合相同）
      // 会产生新实例，读取基于旧实例的发布权限随之失效。mtime+size 保留作辅助检查。
      isFileValid: (p) => this.vault.getAbstractFileByPath(p) === scopeFile,
      // 外部修改不推进插件写入版本：以文件 mtime 为外部变更代数，读前读后比较，
      // 读取期间落地的外部写入同样使本次读取作废（同 stale 处理）。
      getFileStamp: (p) => {
        const file = this.vault.getAbstractFileByPath(p);
        return file instanceof TFile ? `${file.stat?.mtime ?? 0}:${file.stat?.size ?? 0}` : undefined;
      },
      getWriteVersion: (p) => this.pathWriteVersions.get(p) || 0,
      getFrontmatterOverlay: (p) => this.frontmatterOverrides.get(p)?.values ?? null,
      getViewDefRawPayload: (p) => this.viewDefOverrides.get(p)?.rawPayload,
      publishSnapshot: (p, frontmatter) => {
        if (!this.recordCache) return;
        const file = this.vault.getAbstractFileByPath(p);
        if (file instanceof TFile) this.recordCache.set(p, { file, frontmatter });
      },
      clearFrontmatterOverlay: (p) => this.frontmatterOverrides.delete(p),
      clearViewDefOverlay: (p) => this.viewDefOverrides.delete(p),
      notifyRecovered: (p) => {
        // 恢复路径不消费为真实 Obsidian 事件保留的 ownership credits：保守按外部处理。
        this.queuePendingChange({ kind: "changed", path: p, origin: "external" });
      },
    };
  }

  private bumpPathGeneration(path: string): void {
    this.pathGenerations.set(path, (this.pathGenerations.get(path) || 0) + 1);
  }

  /**
   * 写入成功后发布基础快照：recordCache 立即持有落盘后的真值（无差异写入同样修复
   * 旧缓存），并推进写入版本使在途的磁盘读取作废。overlay 照常记录以覆盖 metadata
   * 尚未接管的窗口；后到旧 metadata 事件即便覆盖缓存基底，读取端 overlay 合并 +
   * 过期触发的磁盘对账仍能收敛到正确值。
   */
  private publishCommittedSnapshot(path: string, after: Record<string, unknown>): void {
    this.pathWriteVersions.set(path, (this.pathWriteVersions.get(path) || 0) + 1);
    if (!this.recordCache) return;
    const file = this.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      this.recordCache.set(path, { file, frontmatter: cloneFrontmatter(after) });
    }
  }

  private applyFrontmatterOverride(record: NoteRecord): NoteRecord {
    const override = this.frontmatterOverrides.get(record.file.path);
    if (!override) return record;
    return {
      file: record.file,
      frontmatter: mergeFrontmatterDesired(record.frontmatter, override.values),
    };
  }

  /**
   * 记录 frontmatter 期望存在性快照（optimistic overlay 核心）。
   * 用 exists/value（而非 null=delete），可精确表达「key 存在且值为 null」。
   * metadata cache 追平后自动清理已一致 key；全部追平则删 override。
   */
  private rememberFrontmatterDesired(path: string, desired: Record<string, FrontmatterKeySnapshot>): void {
    this.cleanupFrontmatterOverrides();
    const existing = this.frontmatterOverrides.get(path)?.values || {};
    const combined: Record<string, FrontmatterKeySnapshot> = { ...existing, ...desired };
    const file = this.vault.getAbstractFileByPath(path);
    const cached = file instanceof TFile
      ? this.metadataCache.getFileCache(file)?.frontmatter || {}
      : {};
    const pending = reconcileFrontmatterDesired(combined, cached);
    if (Object.keys(pending).length === 0) {
      this.frontmatterOverrides.delete(path);
      return;
    }
    this.frontmatterOverrides.set(path, {
      values: pending,
      expiresAt: Date.now() + 10000,
    });
  }

  /** 普通 mutateFrontmatter 入口：updates 为 diffFrontmatter 结果（null=delete），转存在性后记忆。 */
  private rememberFrontmatterUpdates(path: string, updates: Record<string, unknown>): void {
    const desired: Record<string, FrontmatterKeySnapshot> = {};
    for (const [key, val] of Object.entries(updates)) {
      desired[key] = val === null ? { exists: false } : { exists: true, value: val };
    }
    this.rememberFrontmatterDesired(path, desired);
  }

  private withFrontmatterOverride(path: string, frontmatter: Record<string, unknown>): Record<string, unknown> {
    this.cleanupFrontmatterOverrides();
    const override = this.frontmatterOverrides.get(path);
    if (!override) return frontmatter;
    return mergeFrontmatterDesired(frontmatter, override.values);
  }

  private cleanupFrontmatterOverrides(): void {
    const now = Date.now();
    for (const [path, override] of this.frontmatterOverrides) {
      if (override.expiresAt > now) continue;
      // 确认交接后才撤保护：过期只调度磁盘对账，overlay 保留到任务发布磁盘真相时
      // 由任务清除。恢复最终失败时【不按时间撤保护】：基础缓存可能已被旧 metadata
      // 覆盖，撤掉 overlay 会露出旧值——保留最后确认快照（写入时已发布）与 overlay，
      // 告警一次；新的磁盘证据（modify/metadata 重置失败门控）或手动刷新到来再交接。
      if (!this.reconcileFailedPaths.has(path)) {
        if (!this.overlayExpiryWarned.has(path)) {
          this.overlayExpiryWarned.add(path);
          console.error(`Note Database: frontmatter overlay awaiting disk hand-off for ${path}`);
        }
        this.reconcileScheduler.schedule(path);
      }
    }
  }

  private rememberViewDefConfig(path: string, config: DatabaseConfig, rawPayload?: unknown): void {
    this.cleanupViewDefOverrides();
    const cloned = this.cloneDatabaseConfig(config);
    linkDatabaseSchema(cloned);
    this.viewDefOverrides.set(path, {
      config: cloned,
      // 同时存 raw payload：metadata 事件只有 cache.database 追上 rawPayload 才删 override
      rawPayload: cloneFrontmatterValue(rawPayload === undefined ? this.toDatabasePayload(config) : rawPayload),
      expiresAt: Date.now() + 10000,
    });
  }

  /** metadata cache 追平 frontmatter 期望状态时移除对应 key，否则保留（避免误删较新 overlay）。 */
  private reconcileFrontmatterOverride(file: TFile): void {
    const override = this.frontmatterOverrides.get(file.path);
    if (!override) return;
    const cached = this.metadataCache.getFileCache(file)?.frontmatter || {};
    const remaining = reconcileFrontmatterDesired(override.values, cached);
    if (Object.keys(remaining).length === 0) this.frontmatterOverrides.delete(file.path);
    else this.frontmatterOverrides.set(file.path, { values: remaining, expiresAt: override.expiresAt });
  }

  /** view-def override：cache.database 与记录的 rawPayload 一致才删（否则保留）。 */
  private reconcileViewDefOverride(file: TFile): void {
    const override = this.viewDefOverrides.get(file.path);
    if (!override) return;
    const cachedFrontmatter = this.metadataCache.getFileCache(file)?.frontmatter;
    const cachedPayload: unknown = cachedFrontmatter ? cachedFrontmatter["database"] : undefined;
    if (configsDeepEqual(cachedPayload, override.rawPayload)) {
      this.viewDefOverrides.delete(file.path);
    }
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
      if (override.expiresAt > now) continue;
      // 同 frontmatter overlay：确认交接后才撤保护；最终失败保留 overlay 与最后确认
      // 快照，等待新磁盘证据（失败门控重置）再交接，不按时间丢弃。
      if (!this.reconcileFailedPaths.has(path)) {
        if (!this.overlayExpiryWarned.has(path)) {
          this.overlayExpiryWarned.add(path);
          console.error(`Note Database: view-def overlay awaiting disk hand-off for ${path}`);
        }
        this.reconcileScheduler.schedule(path);
      }
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
