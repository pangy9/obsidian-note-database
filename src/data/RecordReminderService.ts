import { Notice, type App, type TFile } from "obsidian";
import { t } from "../i18n";
import type { DesktopReminderNotification } from "./DesktopReminderNotification";
import { buildRecordReminderNotice, reminderInboxTargetIdentity, type ReminderInboxTarget } from "./RecordReminderNotice";
import type { DataSource, RecordIdentityChange } from "./DataSource";
import { withDatabaseSourceScope } from "./SourceRules";
import { holdReminderReads, observeReminderReadBarrier } from "./ReminderReadBarrier";
import { configsDeepEqual } from "./FrontmatterPatch";
import { getReminderRecordEditTarget, planReminderRecordEdit, type ReminderRecordEdit, type ReminderRecordEditTarget } from "./RecordReminderEditing";
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "./RenameTransaction";
import { collectDueRecordReminders, isRecordReminderKeyForPath, isSameReminderSchedule, migrateRecordReminderStates, remapRecordReminderDateFieldKey, remapRecordReminderKey, type DueRecordReminder, type RecordReminderSettings, type RecordReminderState } from "./RecordReminders";

interface ReminderStateWrite {
  key: string;
  deleted?: boolean;
  committed?: RecordReminderState;
  undo: boolean;
}

/** One scheduler per vault; independent of open views, filters and result limits. */
export class RecordReminderService {
  private announced = new Set<string>();
  private quietlyRefreshFile?: TFile;
  private unsubscribe: () => void;
  private notice?: Notice;
  private fallbackBatch?: Set<string>;
  private targetCache?: { signature: string; entries: ReturnType<DataSource["getViewDefFiles"]> };
  private stopped = false;
  private stablePending?: DueRecordReminder[];
  private readonly stateWrites = new Set<ReminderStateWrite>();
  private readonly fileInstances = new WeakMap<TFile, number>();
  private fileSequence = 0;
  private stateSaveDirty = false;
  private stateSaveInFlight = false;
  constructor(private app: App, private source: DataSource, private settings: () => RecordReminderSettings,
    private save: () => Promise<void>, private open: (target?: ReminderInboxTarget) => void, private enabled: () => boolean = () => true,
    private readonly transaction: <T>(write: () => Promise<T>) => Promise<T> = write => write(),
    private readonly desktopNotification?: DesktopReminderNotification,
    private readonly desktopPreviewEnabled: () => boolean = () => true) {
    const notifyIdentity = source.onRecordIdentityChange?.(change => {
      this.onIdentityChange(change);
      // Persistence must not wait for the debounced view refresh, which can
      // be cancelled by a plugin reload immediately after a rename.
      this.persistMaintainedStates();
    });
    const data = source.onDataChanged(batch => {
      const known = new Set(this.targetCache?.entries.map(e => e.file.path));
      if (batch.changes.some(change => known.has(change.path) || (change.oldPath && known.has(change.oldPath)) ||
        source.getRecordSnapshot(change.path)?.frontmatter.db_view === true)) this.targetCache = undefined;
      if (!notifyIdentity) for (const { kind, oldPath, path } of batch.changes) {
        if (kind === "deleted") this.onIdentityChange({ kind, path });
        else if (kind === "renamed" && oldPath) this.onIdentityChange({ kind, oldPath, path });
      }
      this.tick();
    });
    const config = source.onViewConfigChanged(() => { this.targetCache = undefined; this.tick(); });
    const barrier = observeReminderReadBarrier(source, busy => {
      try {
        if (busy) this.stablePending = this.pending();
        else { this.stablePending = undefined; this.refresh(); }
      } catch (error) {
        // Observing the transaction must not change its outcome.
        this.stablePending = busy ? [] : undefined;
        console.error("Note Database: failed to refresh the reminder snapshot", error);
      }
    });
    this.unsubscribe = () => { data(); config(); notifyIdentity?.(); barrier(); };
  }

  private onIdentityChange(change: RecordIdentityChange): void {
    const { path } = change;
    if (this.targetCache?.entries.some(({ file }) => file.path === path || file.path.startsWith(path + "/")
      || (change.kind === "renamed" && (file.path === change.oldPath || file.path.startsWith(change.oldPath + "/"))))) {
      this.targetCache = undefined;
    }
    const states = this.settings().states;
    if (change.kind === "deleted") {
      for (const key of Object.keys(states)) {
        if (!isRecordReminderKeyForPath(key, path)) continue;
        delete states[key];
        this.stateSaveDirty = true;
      }
      for (const key of this.announced) if (isRecordReminderKeyForPath(key, path)) this.announced.delete(key);
      for (const write of this.stateWrites) if (isRecordReminderKeyForPath(write.key, path)) write.deleted = true;
      return;
    }
    const { oldPath } = change;
    if (migrateRecordReminderStates(states, oldPath, path)) this.stateSaveDirty = true;
    // Track in-flight writes across moves, even if undo temporarily removed the state.
    for (const write of this.stateWrites) write.key = remapRecordReminderKey(write.key, oldPath, path);
    for (const key of this.announced) {
      const next = remapRecordReminderKey(key, oldPath, path);
      if (next === key) continue;
      this.announced.delete(key);
      this.announced.add(next);
    }
  }
  pending(): DueRecordReminder[] {
    if (this.stopped || !this.enabled()) return [];
    if (this.stablePending) return this.stablePending;
    const settings = this.settings();
    const ids = new Set(settings.rules.filter(r => r.enabled).map(r => r.databaseId));
    if (!ids.size) return [];
    const signature = [...ids].sort().join("\n");
    if (this.targetCache?.signature !== signature) this.targetCache = { signature, entries: this.source.getViewDefFiles().filter(({ config }) => ids.has(config.id)) };
    const targets = this.targetCache.entries.map(({ file, config }) => ({
      database: config, records: this.source.getRecordsForDatabase(withDatabaseSourceScope({ ...config, baseThisFilePath: file.path })),
    }));
    // Polling and the inbox only see the committed state while an action is saving.
    const writes = [...this.stateWrites].filter(write => !write.deleted);
    const visible = writes.length ? { ...settings, states: { ...settings.states } } : settings;
    for (const write of writes) {
      if (write.committed) visible.states[write.key] = write.committed;
      else delete visible.states[write.key];
    }
    return collectDueRecordReminders(visible, targets, Date.now(), file => this.getFileInstance(file));
  }
  private getFileInstance(file: TFile): number {
    const existing = this.fileInstances.get(file);
    if (existing !== undefined) return existing;
    const instance = ++this.fileSequence;
    this.fileInstances.set(file, instance);
    return instance;
  }
  isOriginalRecord(reminder: DueRecordReminder, file: TFile): boolean {
    return reminder.instance === this.fileInstances.get(file) && reminder.instance !== undefined;
  }
  remapAnnouncedDateField(databaseId: string, oldKey: string, newKey: string, ruleIds: ReadonlySet<string>): void {
    for (const key of this.announced) {
      const next = remapRecordReminderDateFieldKey(key, databaseId, oldKey, newKey, ruleIds);
      if (next === key) continue;
      this.announced.delete(key);
      this.announced.add(next);
    }
  }
  refresh(): void { this.targetCache = undefined; this.tick(); }

  private persistMaintainedStates(): void {
    if (!this.stateSaveDirty || this.stateSaveInFlight) return;
    this.stateSaveDirty = false;
    this.stateSaveInFlight = true;
    void this.transaction(() => this.save()).then(() => {
      this.stateSaveInFlight = false;
      this.persistMaintainedStates();
    }, (error: unknown) => {
      // Keep the live path mapping active; retry persistence on the next scheduler tick.
      this.stateSaveInFlight = false;
      this.stateSaveDirty = true;
      console.error("Note Database: failed to save reminder state maintenance", error);
    });
  }
  tick(): void {
    if (this.stopped) return;
    this.persistMaintainedStates();
    if (!this.enabled()) {
      this.notice?.hide();
      this.notice = undefined;
      this.desktopNotification?.destroy();
      return;
    }
    this.desktopNotification?.closeIfDisabled();
    if (this.stablePending) return;
    const savingUndo = new Set([...this.stateWrites].filter(write => write.undo && !write.deleted).map(write => write.key));
    // A just-undone reminder is not actionable until the settings write commits.
    // In particular a concurrent rename may tick during the optimistic update.
    const pending = savingUndo.size ? this.pending().filter(item => !savingUndo.has(item.key)) : this.pending();
    const keys = new Set(pending.map(r => r.key));
    if (this.quietlyRefreshFile) for (const item of pending) {
      if (this.isOriginalRecord(item, this.quietlyRefreshFile)) this.announced.add(item.key);
    }
    for (const key of this.announced) if (!keys.has(key)) this.announced.delete(key);
    const fresh = pending.filter(r => !this.announced.has(r.key));
    if (!fresh.length) {
      if (!pending.length) {
        this.notice?.hide();
        this.desktopNotification?.close();
      }
      return;
    }
    fresh.forEach(r => this.announced.add(r.key));
    this.notice?.hide();
    this.notice = undefined;
    if (this.desktopNotification) {
      const preview = this.desktopPreviewEnabled();
      const message = buildRecordReminderNotice(fresh, preview, preview ? this.app.vault.getName() : "");
      if (this.desktopNotification.show(message.title, message.body, () => this.queueDesktopFallback(fresh),
        message.target)) return;
    }
    if (this.fallbackBatch) this.queueDesktopFallback(fresh);
    else this.showInAppNotice(fresh);
  }

  private queueDesktopFallback(items: readonly DueRecordReminder[]): void {
    if (this.stopped || !this.enabled()) return;
    if (!this.fallbackBatch) {
      const batch = this.fallbackBatch = new Set<string>();
      // A setting change can cancel several pending notifications at once.
      // Show one combined notice instead of replacing each notice immediately.
      queueMicrotask(() => {
        this.fallbackBatch = undefined;
        if (this.stopped || !this.enabled()) return;
        const remaining = this.pending().filter(item => batch.has(reminderInboxTargetIdentity(item)));
        if (remaining.length) this.showInAppNotice(remaining);
      });
    }
    for (const item of items) this.fallbackBatch.add(reminderInboxTargetIdentity(item));
  }

  private showInAppNotice(items: readonly DueRecordReminder[]): void {
    const message = buildRecordReminderNotice(items, true);
    this.notice?.hide();
    const content = this.app.workspace.containerEl.ownerDocument.createDocumentFragment();
    const label = content.createSpan({ text: message.body });
    label.addClass("db-reminder-notice-label");
    content.createEl("button", {
      cls: "db-reminder-notice-action",
      text: t("reminder.noticeOpen"),
      attr: { type: "button", "aria-label": t("reminder.view") },
    }).onclick = () => { this.notice?.hide(); this.open(message.target); };
    this.notice = new Notice(content, 10000);
  }

  editTarget(item: DueRecordReminder): ReminderRecordEditTarget | undefined {
    if (this.stopped || !this.enabled() || this.stablePending) return;
    const live = this.pending().find(candidate => candidate.key === item.key && candidate.instance === item.instance);
    const record = live && this.source.getRecordSnapshot(item.path);
    if (!live || !record || !this.isOriginalRecord(item, record.file)) return;
    const rule = this.settings().rules.find(candidate => candidate.id === item.ruleId && candidate.databaseId === item.databaseId);
    const db = this.source.getViewDefFiles().find(entry => entry.config.id === item.databaseId)?.config;
    return rule && db ? getReminderRecordEditTarget(rule, db, record.frontmatter, live) : undefined;
  }

  editRecord(item: DueRecordReminder, target: ReminderRecordEditTarget, change: ReminderRecordEdit):
    Promise<(() => Promise<boolean>) | undefined> {
    return this.transaction(async () => {
      if (!configsDeepEqual(this.editTarget(item), target)) return;
      const file = this.source.getRecordSnapshot(item.path)?.file;
      if (!file || !this.isOriginalRecord(item, file)) return;
      const writes = planReminderRecordEdit(target, change);
      const keys = Object.keys(writes);
      if (!keys.length) return;
      const expectedAfter: Record<string, FrontmatterKeySnapshot> = {};
      const undo: Record<string, FrontmatterWrite> = {};
      for (const key of keys) {
        const operation = writes[key];
        if (operation.kind !== "set") throw new Error("Unexpected reminder edit");
        expectedAfter[key] = { exists: true, value: operation.value };
        const original = target.original[key];
        undo[key] = original.exists ? { kind: "set", value: original.value } : { kind: "delete" };
      }
      const originalRecord = Object.fromEntries(Object.entries(target.original)
        .filter(([, original]) => original.exists).map(([key, original]) => [key, original.value]));
      const ruleStillMatches = (): boolean => {
        const entry = this.source.getViewDefFiles().find(candidate => candidate.config.id === item.databaseId);
        const current = this.settings().rules.find(candidate => candidate.id === item.ruleId && candidate.databaseId === item.databaseId);
        return !!current && !!entry && configsDeepEqual(
          getReminderRecordEditTarget(current, entry.config, originalRecord, item),
          target,
        );
      };
      const persist = async (path: string, expected: Record<string, FrontmatterKeySnapshot>,
        next: Record<string, FrontmatterWrite>, validateRule: boolean): Promise<void> => {
        const release = holdReminderReads(this.source);
        try {
          await this.source.patchFrontmatter(path, expected, next, () => {
            if (this.stopped || !this.enabled() || this.source.getRecordSnapshot(path)?.file !== file ||
              (validateRule && !ruleStillMatches())) throw new Error(t("reminder.itemChanged"));
          });
          // Keep changes made from the active inbox from immediately re-announcing the same record.
          this.quietlyRefreshFile = file;
        } finally {
          try { release(); } finally { this.quietlyRefreshFile = undefined; }
        }
      };
      await persist(item.path, target.original, writes, true);
      return () => this.transaction(async () => {
        if (this.stopped || !this.enabled() || this.source.getRecordSnapshot(file.path)?.file !== file) return false;
        const latest = await this.source.readFrontmatterKeySnapshots(file.path, keys);
        if (!configsDeepEqual(latest, expectedAfter)) return false;
        await persist(file.path, expectedAfter, undo, false);
        return true;
      });
    });
  }

  update(reminder: DueRecordReminder, snooze: boolean | number): Promise<(() => Promise<boolean>) | undefined> {
    return this.transaction(() => this.applyUpdate(reminder, snooze));
  }

  private async applyUpdate(reminder: DueRecordReminder, snooze: boolean | number): Promise<(() => Promise<boolean>) | undefined> {
    if (this.stopped || !this.enabled() || this.stablePending) return;
    // A hovered inbox row can outlive a rename or be replaced by a newer trigger.
    // Do not attach an action to a stale key (including a path now owned by a different trigger).
    if ([...this.stateWrites].some(write => write.key === reminder.key && !write.deleted) ||
        !this.pending().some(item => item.key === reminder.key && item.instance === reminder.instance)) return;
    const settings = this.settings();
    const before = settings.states[reminder.key];
    const now = Date.now();
    const until = typeof snooze === "number" ? snooze : snooze ? now + 10 * 60000 : undefined;
    if (until !== undefined && (!Number.isFinite(until) || until <= now)) return;
    const next: RecordReminderState = { updatedAt: now, ...(until !== undefined ? { snoozedUntil: until } : { dismissed: true }) };
    const updateWrite: ReminderStateWrite = { key: reminder.key, committed: before, undo: false };
    this.stateWrites.add(updateWrite);
    settings.states[reminder.key] = next;
    try { await this.save(); } catch (error) {
      // A rename may have moved the exact state object while persistence was pending.
      const liveKey = Object.keys(settings.states).find(key => settings.states[key] === next);
      if (liveKey) {
        if (before) settings.states[liveKey] = before;
        else delete settings.states[liveKey];
        if (liveKey !== reminder.key) this.stateSaveDirty = true;
      }
      throw error;
    } finally {
      this.stateWrites.delete(updateWrite);
    }
    if (updateWrite.deleted) return;
    this.announced.delete(updateWrite.key);
    this.tick();
    return () => this.transaction(async () => {
      if (this.stopped || !this.enabled() || this.settings() !== settings) return false;
      const liveKey = Object.keys(settings.states).find(key => settings.states[key] === next);
      if (!liveKey) return false; // A later action has superseded this one.
      const write: ReminderStateWrite = { key: liveKey, committed: next, undo: true };
      this.stateWrites.add(write);
      if (before) settings.states[liveKey] = before;
      else delete settings.states[liveKey];
      try {
        await this.save();
      } catch (error) {
        if (!write.deleted && settings.states[write.key] === before) {
          settings.states[write.key] = next;
          if (write.key !== liveKey) this.stateSaveDirty = true;
        }
        throw error;
      } finally {
        this.stateWrites.delete(write);
      }
      // An explicit undo should not immediately raise an extra notification for a row already on-screen.
      if (write.deleted) return false;
      this.announced.add(write.key);
      if (next.snoozedUntil !== undefined) {
        for (const item of this.pending()) if (isSameReminderSchedule(write.key, item.key)) this.announced.add(item.key);
      }
      this.tick();
      return true;
    });
  }
  destroy(): void {
    if (this.stopped) return;
    this.persistMaintainedStates();
    this.stopped = true;
    this.unsubscribe();
    this.desktopNotification?.destroy();
    this.notice?.hide();
    this.announced.clear();
  }
}
