import { MarkdownView, Notice, Platform, WorkspaceWindow, setIcon, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";

export type DatabaseReturnView = "calendar" | "timeline" | "board";
const activeJourneys = new WeakMap<App, () => void>();

export function clearDatabaseNoteReturn(app: App): void {
  activeJourneys.get(app)?.();
}

// A sidebar, search field, native menu, or loss of window focus is not editor navigation.
export function shouldDismissDatabaseReturn(input: {
  sourceValid: boolean; targetValid: boolean; stillOnNote: boolean; switchedEditor: boolean;
}): boolean {
  return !input.sourceValid || !input.targetValid || !input.stillOnNote || input.switchedEditor;
}

export function isEditorLeaf(app: App, leaf: WorkspaceLeaf): boolean {
  if (leaf.getContainer() instanceof WorkspaceWindow) return true;
  let isEditor = false;
  app.workspace.iterateRootLeaves(root => { if (root === leaf) isEditor = true; });
  return isEditor;
}

function isVisible(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win || !el.isConnected || !el.getClientRects().length) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth
    && win.getComputedStyle(el).visibility !== "hidden";
}

export interface OpenDatabaseCardNoteOptions {
  app: App;
  file: TFile;
  host: HTMLElement;
  anchor: HTMLElement;
  view: DatabaseReturnView;
  sourceStillCurrent?: () => boolean;
  openNormally: () => void;
}

/** Used only by explicit foreground 'open note' buttons on desktop cards. */
export async function openDatabaseCardNote(options: OpenDatabaseCardNoteOptions): Promise<void> {
  const { app, file, anchor, host, view, openNormally } = options;
  if (Platform.isMobile) { openNormally(); return; }
  const workspace = app.workspace;
  let source: WorkspaceLeaf | undefined;
  workspace.iterateAllLeaves(leaf => {
    if (leaf.view.containerEl.contains(host)) source = leaf;
  });
  if (!source) { openNormally(); return; }
  const origin = source;
  const sourceView = origin.view;
  const sourceFile = sourceView instanceof MarkdownView ? sourceView.file : undefined;
  const sameOrigin = (): boolean => origin.view === sourceView
    && (sourceFile === undefined || (origin.view instanceof MarkdownView && origin.view.file === sourceFile))
    && (options.sourceStillCurrent?.() ?? true);
  clearDatabaseNoteReturn(app);
  let cancelled = false;
  let cleanupListeners = (): void => {};
  const dispose = (): void => {
    if (cancelled) return;
    cancelled = true;
    cleanupListeners();
    if (activeJourneys.get(app) === dispose) activeJourneys.delete(app);
  };
  activeJourneys.set(app, dispose);
  try {
    // Keep the database view alive instead of reconstructing transient filters and scroll state after Back.
    const existing = workspace.getLeavesOfType("markdown").find(leaf => leaf.view instanceof MarkdownView && leaf.view.file === file
      && leaf.view.containerEl.ownerDocument === host.ownerDocument);
    const target = existing ?? workspace.getLeaf("tab");
    if (!existing) {
      const pending = workspace.on("active-leaf-change", leaf => {
        if (leaf && leaf !== target && isEditorLeaf(app, leaf)) dispose();
      });
      cleanupListeners = () => workspace.offref(pending);
      try {
        await target.openFile(file, { active: false });
      } finally {
        if (!cancelled) cleanupListeners();
        cleanupListeners = () => {};
      }
    }
    if (cancelled || !sameOrigin()) { dispose(); return; }
    workspace.setActiveLeaf(target, { focus: true });
    const win = target.view.containerEl.ownerDocument.defaultView;
    if (!win) { dispose(); return; }
    const doc = target.view.containerEl.ownerDocument;
    let frame = win.requestAnimationFrame(() => {
      if (cancelled) return;
      const currentEditor = workspace.getMostRecentLeaf();
      if ((currentEditor && currentEditor !== target) || target === origin || !sameOrigin()
        || isVisible(origin.view.containerEl)) { dispose(); return; }
      const capsule = doc.body.createDiv({ cls: "db-return-to-view" });
      const create = (label: string, icon: string, text: boolean): HTMLButtonElement => {
        const button = capsule.createEl("button", { attr: { type: "button", "aria-label": label, title: label } });
        setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), icon);
        if (text) button.createSpan({ text: label });
        return button;
      };
      const back = create(t(`recordReturn.${view}`), "arrow-left", true);
      const close = create(t("recordReturn.dismiss"), "x", false);
      let switchedEditor = false;
      const check = (): void => {
        frame = 0;
        let sourceValid = false;
        let targetValid = false;
        workspace.iterateAllLeaves(leaf => {
          if (leaf === origin) sourceValid = sameOrigin();
          if (leaf === target) targetValid = true;
        });
        const stillOnNote = target.view instanceof MarkdownView && target.view.file === file;
        if (shouldDismissDatabaseReturn({ sourceValid, targetValid, stillOnNote, switchedEditor }) || isVisible(origin.view.containerEl)) {
          dispose(); return;
        }
        const pane = target.view.containerEl.getBoundingClientRect();
        if (!isVisible(target.view.containerEl)) { dispose(); return; }
        const inset = Math.max(8, win.innerWidth - pane.right + 12);
        const top = pane.width >= 600 ? pane.top + pane.height / 2 : pane.bottom - 32;
        capsule.setCssProps({ right: `${inset}px`, top: `${Math.max(pane.top + 18, top)}px`, maxWidth: `${Math.max(0, pane.width - 24)}px` });
      };
      const schedule = (): void => { if (!frame && !cancelled) frame = win.requestAnimationFrame(check); };
      const refs = [
        workspace.on("active-leaf-change", leaf => {
          if (leaf && leaf !== target && isEditorLeaf(app, leaf)) switchedEditor = true;
          schedule();
        }),
        workspace.on("file-open", schedule),
        workspace.on("layout-change", schedule),
        app.vault.on("rename", schedule),
      ];
      const resize = new ResizeObserver(schedule);
      resize.observe(target.view.containerEl);
      win.addEventListener("resize", schedule);
      close.onclick = dispose;
      back.onclick = () => {
        dispose();
        if (!sameOrigin()) return;
        workspace.setActiveLeaf(origin, { focus: false });
        // Wait for the original workspace tab to be revealed before restoring keyboard focus.
        const originWindow = origin.view.containerEl.ownerDocument.defaultView ?? win;
        originWindow.requestAnimationFrame(() => originWindow.requestAnimationFrame(() => {
          if (workspace.getMostRecentLeaf() !== origin || !sameOrigin()) return;
          const selector = "[data-note-database-row-path]";
          const candidates = [anchor, ...host.querySelectorAll<HTMLElement>(selector)];
          const row = candidates.find(element => element.getAttribute("data-note-database-row-path") === file.path
            && !element.closest(".is-hidden") && isVisible(element));
          if (row) {
            if (!row.matches("a,button,input,[tabindex]")) row.tabIndex = -1;
            row.focus({ preventScroll: true });
          } else if (isVisible(origin.view.containerEl)) {
            workspace.setActiveLeaf(origin, { focus: true });
          }
        }));
      };
      cleanupListeners = () => {
        win.cancelAnimationFrame(frame);
        workspace.offref(refs[0]); workspace.offref(refs[1]); workspace.offref(refs[2]);
        app.vault.offref(refs[3]);
        resize.disconnect();
        win.removeEventListener("resize", schedule);
        capsule.remove();
      };
      frame = 0;
      check();
    });
    cleanupListeners = () => win.cancelAnimationFrame(frame);
  } catch {
    if (cancelled) return;
    dispose();
    new Notice(t("reminder.noteUnavailable"));
  }
}
