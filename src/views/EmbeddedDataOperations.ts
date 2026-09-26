import { App, Notice, TFile } from "obsidian";
import { t } from "../i18n";
import { DataSource } from "../data/DataSource";
import { EmbeddedDataHistory, type ReversibleDataStep } from "../data/EmbeddedDataHistory";
import { cloneFrontmatterValue } from "../data/FrontmatterOverride";
import { configsDeepEqual } from "../data/FrontmatterPatch";
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "../data/RenameTransaction";
import type { ColumnDef, DatabaseConfig, ViewConfig } from "../data/types";
import { remapRecordPathsInConfig } from "../data/RecordPathRemap";
import { buildBulkEditPlan, resolveBulkEditorRequest } from "../data/BulkEdit";
import { planOptionRegistration } from "../data/OptionRegistration";
import { planEmbeddedGroupWrite } from "../data/EmbeddedEditing";
import { generateRanks, rankBetween, rebalanceRanks } from "../data/ManualOrder";
import type { CellOptionTransaction } from "./CellRenderer";

export interface EmbeddedOperationContext { path: string; dbId: string; viewId: string }
export interface EmbeddedCellWrite { path: string; column: ColumnDef; value: unknown }
interface FileRef { file: TFile | null }
type Snapshots = Record<string, FrontmatterKeySnapshot>;

/** Production adapter for reversible embedded data mutations. All operation families share history. */
export class EmbeddedDataOperations {
  private histories = new Map<string, EmbeddedDataHistory>();
  private refs = new WeakMap<TFile, FileRef>();
  private active = 0;
  constructor(
    private app: App,
    private data: DataSource,
    private sourceInstanceId: string,
    private context: () => EmbeddedOperationContext | undefined,
    private writable: () => boolean,
    private refresh: () => void,
    private beforePrepare: () => Promise<void> = async () => {},
    private busyChanged: (busy: boolean) => void = () => {},
  ) {}
  get busy(): boolean { return this.active > 0; }
  private history(path: string): EmbeddedDataHistory {
    let history = this.histories.get(path);
    if (!history) { history = new EmbeddedDataHistory(); this.histories.set(path, history); }
    return history;
  }
  get canUndo(): boolean { const ctx = this.context(); return !!ctx && this.history(ctx.path).canUndo; }
  get canRedo(): boolean { const ctx = this.context(); return !!ctx && this.history(ctx.path).canRedo; }
  get undoLabel(): string | undefined { const ctx = this.context(); return ctx && this.history(ctx.path).undoLabel; }

  private assertContext(ctx: EmbeddedOperationContext): void {
    const now = this.context();
    if (!this.writable() || now?.path !== ctx.path || now.dbId !== ctx.dbId) throw new Error(t("notice.editInFullView"));
  }
  private getRef(path: string): FileRef {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
    let ref = this.refs.get(file);
    if (!ref) { ref = { file }; this.refs.set(file, ref); }
    return ref;
  }
  private assertRef(path: string, ref: FileRef): TFile {
    if (!ref.file || this.app.vault.getAbstractFileByPath(path) !== ref.file) throw new Error(`File identity changed: ${path}`);
    return ref.file;
  }
  private guard(ctx: EmbeddedOperationContext, compensating: boolean, path?: string, ref?: FileRef): () => void {
    return () => {
      if (!compensating) this.assertContext(ctx);
      if (path && ref) this.assertRef(path, ref);
    };
  }
  private async run(label: string, prepare: (ctx: EmbeddedOperationContext) => Promise<ReversibleDataStep[]>): Promise<boolean> {
    const ctx = this.context();
    if (!ctx || !this.writable()) return false;
    this.active++;
    this.busyChanged(true);
    try {
      return await this.history(ctx.path).perform(label, async () => {
        await this.beforePrepare();
        this.assertContext(ctx);
        const steps = await prepare(ctx);
        this.assertContext(ctx);
        return steps;
      });
    } catch (error) {
      console.error("Note Database: embedded data operation failed", error);
      new Notice(t("errors.updateFailed", { error: String(error) }));
      return false;
    } finally { this.active--; this.busyChanged(this.busy); this.refresh(); }
  }
  async replay(direction: "undo" | "redo"): Promise<void> {
    const ctx = this.context();
    if (!ctx || !this.writable() || this.busy) return;
    this.active++;
    this.busyChanged(true);
    try {
      await this.beforePrepare();
      this.assertContext(ctx);
      const label = await this.history(ctx.path).replay(direction);
      if (label) new Notice(t(direction === "undo" ? "notice.undone" : "notice.redone", { action: label }));
    } catch (error) {
      console.error("Note Database: embedded history replay failed", error);
      new Notice(t("errors.updateFailed", { error: String(error) }));
    } finally { this.active--; this.busyChanged(this.busy); this.refresh(); }
  }

  private snapshotsStep(ctx: EmbeddedOperationContext, path: string, ref: FileRef, before: Snapshots, after: Snapshots): ReversibleDataStep {
    return { description: path, apply: async (direction, compensating) => {
      const expect = direction === "forward" ? before : after;
      const desired = direction === "forward" ? after : before;
      const writes: Record<string, FrontmatterWrite> = {};
      for (const [key, snapshot] of Object.entries(desired)) writes[key] = snapshot.exists
        ? { kind: "set", value: cloneFrontmatterValue(snapshot.value) } : { kind: "delete" };
      await this.data.patchFrontmatter(path, expect, writes, this.guard(ctx, compensating, path, ref));
    } };
  }
  private async updatesStep(ctx: EmbeddedOperationContext, path: string, updates: Record<string, unknown>): Promise<ReversibleDataStep | undefined> {
    const ref = this.getRef(path);
    const before = await this.data.readFrontmatterKeySnapshots(path, Object.keys(updates));
    this.assertRef(path, ref);
    const after: Snapshots = {};
    for (const [key, value] of Object.entries(updates)) after[key] = value === null ? { exists: false } : { exists: true, value: cloneFrontmatterValue(value) };
    return configsDeepEqual(before, after) ? undefined : this.snapshotsStep(ctx, path, ref, before, after);
  }
  private async configStep(ctx: EmbeddedOperationContext, change: (db: DatabaseConfig, view: ViewConfig) => void): Promise<ReversibleDataStep | undefined> {
    const ref = this.getRef(ctx.path);
    const snapshot = await this.data.readViewDefSnapshot(ctx.path);
    this.assertRef(ctx.path, ref);
    if (snapshot.typedConfig.id !== ctx.dbId) throw new Error("Database identity changed");
    const after = cloneFrontmatterValue(snapshot.typedConfig) as DatabaseConfig;
    const view = after.views.find((candidate) => candidate.id === ctx.viewId);
    if (!view) throw new Error("View no longer exists");
    // Keep schema shared, as in the production config loader.
    for (const candidate of after.views) candidate.schema = after.schema;
    change(after, view);
    if (configsDeepEqual(snapshot.typedConfig, after)) return undefined;
    const rawAfter = this.data.serializeDatabaseConfig(after);
    const mutation = { dbId: ctx.dbId, dbPath: ctx.path, sourceInstanceId: this.sourceInstanceId };
    return { description: ctx.path, apply: async (direction, compensating) => {
      await this.data.patchViewDefConfig(ctx.path,
        direction === "forward" ? snapshot.rawPayload : rawAfter,
        direction === "forward" ? rawAfter : snapshot.rawPayload,
        direction === "forward" ? after : snapshot.typedConfig, mutation,
        this.guard(ctx, compensating, ctx.path, ref));
    } };
  }
  private fileStep(ctx: EmbeddedOperationContext, path: string, ref: FileRef, before: string | null, after: string | null): ReversibleDataStep {
    return { description: path, apply: async (direction, compensating) => {
      const expected = direction === "forward" ? before : after;
      const desired = direction === "forward" ? after : before;
      const file = await this.data.patchNoteExistence(path, expected, desired, ref.file, {
        sourceInstanceId: this.sourceInstanceId, assertWritable: this.guard(ctx, compensating),
      });
      ref.file = file;
      if (file) this.refs.set(file, ref);
    } };
  }

  edit(path: string, updates: Record<string, unknown>, label = t("undo.editCell")): Promise<boolean> {
    const snapshot = cloneFrontmatterValue(updates) as Record<string, unknown>;
    return this.run(label, async (ctx) => {
      const step = await this.updatesStep(ctx, path, snapshot);
      return step ? [step] : [];
    });
  }

  /** Commit heterogeneous cell writes as one reversible transaction. */
  editCells(writes: EmbeddedCellWrite[], label: string): Promise<boolean> {
    const pending = writes.map((write) => ({
      path: write.path,
      column: cloneFrontmatterValue(write.column) as ColumnDef,
      value: cloneFrontmatterValue(write.value),
    }));
    return this.run(label, async (ctx) => {
      const grouped = new Map<string, Record<string, unknown>>();
      for (const write of pending) {
        const key = write.column.key === "file.tags" ? "tags" : write.column.key;
        const updates = grouped.get(write.path) || {};
        updates[key] = write.value;
        grouped.set(write.path, updates);
      }
      const steps: ReversibleDataStep[] = [];
      for (const [path, updates] of grouped) {
        const step = await this.updatesStep(ctx, path, updates);
        if (step) steps.push(step);
      }
      const config = await this.configStep(ctx, (db) => {
        for (const write of pending) {
          const live = db.schema.columns.find((column) => column.key === write.column.key);
          if (!live || live.type !== write.column.type) throw new Error("Field definition changed");
          const registration = planOptionRegistration(live, write.value);
          if (registration.addedOptions.length) live.statusOptions = registration.options;
          if (registration.clearPresetId) live.statusPresetId = undefined;
        }
      });
      if (config) steps.push(config);
      return steps;
    });
  }

  /** Database schema/config edits, optionally paired with record writes, share one history entry. */
  changeDatabase(
    label: string,
    change: (db: DatabaseConfig, view: ViewConfig) => void,
    writes: Array<{ path: string; updates: Record<string, unknown> }> = [],
  ): Promise<boolean> {
    const pending = writes.map((write) => ({ path: write.path, updates: cloneFrontmatterValue(write.updates) as Record<string, unknown> }));
    return this.run(label, async (ctx) => {
      const steps: ReversibleDataStep[] = [];
      for (const write of pending) {
        const step = await this.updatesStep(ctx, write.path, write.updates);
        if (step) steps.push(step);
      }
      const config = await this.configStep(ctx, change);
      if (config) steps.push(config);
      return steps;
    });
  }

  editField(paths: string[], column: ColumnDef, value: unknown, transaction?: CellOptionTransaction, confirm?: (count: number) => Promise<boolean>): Promise<boolean> {
    const targets = [...new Set(paths)];
    const col = cloneFrontmatterValue(column) as ColumnDef;
    const newValue = cloneFrontmatterValue(value);
    const optionChange = transaction && cloneFrontmatterValue(transaction) as CellOptionTransaction;
    return this.run(targets.length > 1 ? t("undo.bulkEdit") : t("undo.editCell"), async (ctx) => {
      const key = col.key === "file.tags" ? "tags" : col.key;
      const refs = new Map(targets.map((path) => [path, this.getRef(path)]));
      const snapshots = new Map<string, Snapshots>();
      for (const path of targets) snapshots.set(path, await this.data.readFrontmatterKeySnapshots(path, [key]));
      const request = resolveBulkEditorRequest(col, newValue);
      const plan = optionChange && !optionChange.setValue ? { changes: [], normalizedValue: null } : buildBulkEditPlan(col, request.mode, request.value, targets.map((path) => ({
        path, oldExists: snapshots.get(path)![key].exists, oldValue: snapshots.get(path)![key].value,
      })));
      const steps: ReversibleDataStep[] = [];
      if (!optionChange || optionChange.setValue) for (const change of plan.changes) {
        steps.push(this.snapshotsStep(ctx, change.path, refs.get(change.path)!, snapshots.get(change.path)!, {
          [key]: request.mode === "clear" ? { exists: false } : { exists: true, value: change.newValue },
        }));
      }
      const config = await this.configStep(ctx, (db) => {
        const live = db.schema.columns.find((candidate) => candidate.key === col.key);
        if (!live || live.type !== col.type) throw new Error("Field definition changed");
        if (optionChange?.nextOptions) {
          if (!configsDeepEqual(live.statusOptions || [], optionChange.previousOptions || [])) throw new Error("Options changed");
          live.statusOptions = optionChange.nextOptions.map((option) => ({ ...option }));
          live.statusPresetId = undefined;
        } else if (!optionChange || optionChange.setValue) {
          const registration = planOptionRegistration(live, plan.normalizedValue);
          if (registration.addedOptions.length) {
            live.statusOptions = registration.options;
            if (registration.clearPresetId) live.statusPresetId = undefined;
          }
        }
      });
      if (config) steps.push(config);
      if (steps.length && confirm && !await confirm(plan.changes.length)) return [];
      return steps;
    });
  }

  changeView(label: string, change: (view: ViewConfig) => void): Promise<boolean> {
    return this.run(label, async (ctx) => {
      const step = await this.configStep(ctx, (_db, view) => change(view));
      return step ? [step] : [];
    });
  }
  move(path: string, groups: Array<{ field: string; fromGroupKey?: string; toGroupKey: string }>, rowPaths: string[], beforePath?: string, afterPath?: string): Promise<boolean> {
    return this.run(t("undo.moveCells"), async (ctx) => {
      const ref = this.getRef(path);
      const keys = groups.map(({ field }) => field === "file.tags" ? "tags" : field);
      const before = await this.data.readFrontmatterKeySnapshots(path, keys);
      const desired: Snapshots = {};
      const config = await this.configStep(ctx, (db, view) => {
        for (const group of groups) {
          const col = db.schema.columns.find((column) => column.key === group.field);
          if (!col) throw new Error("Grouping field no longer exists");
          const key = group.field === "file.tags" ? "tags" : group.field;
          const write = planEmbeddedGroupWrite(col, before[key].value, group.fromGroupKey, group.toGroupKey);
          if (!write) throw new Error("Grouping field is not writable");
          desired[key] = write.value === null ? { exists: false } : { exists: true, value: write.value };
          const registration = planOptionRegistration(col, write.value);
          if (registration.addedOptions.length) col.statusOptions = registration.options;
          if (registration.clearPresetId) col.statusPresetId = undefined;
        }
        let ranks = view.manualOrder?.ranks;
        if (!ranks || !Object.keys(ranks).length) ranks = generateRanks([...new Set(rowPaths)]);
        let rank = rankBetween(beforePath ? ranks[beforePath] : undefined, afterPath ? ranks[afterPath] : undefined);
        if (rank === null) {
          ranks = rebalanceRanks(ranks);
          rank = rankBetween(beforePath ? ranks[beforePath] : undefined, afterPath ? ranks[afterPath] : undefined);
        }
        if (rank) view.manualOrder = { ...view.manualOrder, ranks: { ...ranks, [path]: rank } };
      });
      const steps: ReversibleDataStep[] = [];
      if (!configsDeepEqual(before, desired)) steps.push(this.snapshotsStep(ctx, path, ref, before, desired));
      if (config) steps.push(config);
      return steps;
    });
  }

  moveMany(paths: string[], groups: Array<{ field: string; fromGroupKey?: string; toGroupKey: string }>, rowPaths: string[], beforePath?: string, afterPath?: string): Promise<boolean> {
    const targets = [...new Set(paths)];
    const changesPosition = beforePath !== undefined || afterPath !== undefined;
    if (targets.length === 1 && changesPosition) return this.move(targets[0], groups, rowPaths, beforePath, afterPath);
    return this.run(t("undo.moveCells"), async (ctx) => {
      const refs = new Map(targets.map((path) => [path, this.getRef(path)]));
      const keys = groups.map(({ field }) => field === "file.tags" ? "tags" : field);
      const beforeByPath = new Map<string, Snapshots>();
      for (const path of targets) beforeByPath.set(path, await this.data.readFrontmatterKeySnapshots(path, keys));
      const desiredByPath = new Map<string, Snapshots>();
      const config = await this.configStep(ctx, (db, view) => {
        for (const path of targets) {
          const before = beforeByPath.get(path)!;
          const desired: Snapshots = {};
          for (const group of groups) {
            const col = db.schema.columns.find((column) => column.key === group.field);
            if (!col) throw new Error("Grouping field no longer exists");
            const key = group.field === "file.tags" ? "tags" : group.field;
            const write = planEmbeddedGroupWrite(col, before[key].value, group.fromGroupKey, group.toGroupKey);
            if (!write) throw new Error("Grouping field is not writable");
            desired[key] = write.value === null ? { exists: false } : { exists: true, value: write.value };
            const registration = planOptionRegistration(col, write.value);
            if (registration.addedOptions.length) col.statusOptions = registration.options;
            if (registration.clearPresetId) col.statusPresetId = undefined;
          }
          desiredByPath.set(path, desired);
        }
        if (changesPosition) {
          const moving = new Set(targets);
          const remaining = rowPaths.filter((path) => !moving.has(path));
          let index = afterPath ? remaining.indexOf(afterPath) : -1;
          if (index < 0 && beforePath) index = remaining.indexOf(beforePath) + 1;
          if (index < 0) index = remaining.length;
          remaining.splice(index, 0, ...targets.filter((path) => rowPaths.includes(path)));
          view.manualOrder = {
            ...view.manualOrder,
            // Re-rank the visible scope as a block, retaining ranks for filtered/hidden records.
            ranks: { ...(view.manualOrder?.ranks || {}), ...generateRanks(remaining) },
          };
        }
      });
      const steps: ReversibleDataStep[] = [];
      for (const path of targets) {
        const before = beforeByPath.get(path)!;
        const desired = desiredByPath.get(path)!;
        if (!configsDeepEqual(before, desired)) steps.push(this.snapshotsStep(ctx, path, refs.get(path)!, before, desired));
      }
      if (config) steps.push(config);
      return steps;
    });
  }
  create(
    folder: string,
    filename: string,
    frontmatter: Record<string, unknown>,
    body: string,
    processTemplate?: (file: TFile) => Promise<void>,
  ): Promise<boolean> {
    return this.run(t("notice.createEntry"), async (ctx) => {
      const { path, content } = this.data.prepareNoteCreation(folder, filename, frontmatter, body);
      const ref: FileRef = { file: null };
      if (!processTemplate) return [this.fileStep(ctx, path, ref, null, content)];
      // Templater edits the newly created file. Capture its final bytes so undo
      // checks the real content and redo restores it without running scripts again.
      let finalContent = content;
      let firstCreate = true;
      return [{ description: path, apply: async (direction: "forward" | "reverse", compensating: boolean) => {
        const file = await this.data.patchNoteExistence(
          path,
          direction === "forward" ? null : finalContent,
          direction === "forward" ? finalContent : null,
          ref.file,
          { sourceInstanceId: this.sourceInstanceId, assertWritable: this.guard(ctx, compensating) },
        );
        ref.file = file;
        if (file) this.refs.set(file, ref);
        if (direction !== "forward" || !firstCreate || !file) return;
        firstCreate = false;
        try {
          await processTemplate(file);
        } catch (error) {
          new Notice(t("template.templaterFailed", { error: String(error) }));
        }
        try {
          finalContent = await this.app.vault.read(file);
        } catch (error) {
          // Keep the raw snapshot; a later undo will refuse to delete changed
          // content rather than discard a file whose final bytes are unknown.
          new Notice(t("errors.updateFailed", { error: String(error) }));
        }
      } }];
    });
  }
  delete(paths: string[]): Promise<boolean> {
    const targets = [...new Set(paths)];
    return this.run(t("notice.deleteEntry"), async (ctx) => {
      const steps: ReversibleDataStep[] = [];
      for (const path of targets) {
        const ref = this.getRef(path);
        const content = await this.app.vault.read(this.assertRef(path, ref));
        steps.push(this.fileStep(ctx, path, ref, content, null));
      }
      return steps;
    });
  }
  rename(oldPath: string, newPath: string): Promise<boolean> {
    return this.run(t("undo.renameFile"), async (ctx) => {
      if (oldPath === newPath) return [];
      const ref = this.getRef(oldPath);
      const rename: ReversibleDataStep = { description: `${oldPath} -> ${newPath}`, apply: async (direction, compensating) => {
        const from = direction === "forward" ? oldPath : newPath;
        const to = direction === "forward" ? newPath : oldPath;
        await this.data.renameNoteGuarded(this.assertRef(from, ref), to, {
          sourceInstanceId: this.sourceInstanceId, assertWritable: this.guard(ctx, compensating, from, ref),
        });
      } };
      const config = await this.configStep(ctx, (db) => remapRecordPathsInConfig(db, [{ oldPath, newPath }], "new"));
      return config ? [rename, config] : [rename];
    });
  }
}
