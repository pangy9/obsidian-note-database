import { ToggleComponent, setIcon } from "obsidian";
import { t } from "../../i18n";
import { DragDropFeedbackState } from "../DragDropFeedback";
import { closeDropdownForRoot, openDropdownMenu } from "../DropdownField";
import { renderButtonMenuIcon } from "../RecordButtonMenuIcons";

export interface ButtonSummaryTag { text: string; icon?: string; kind: "target" | "property" | "variable" }

/** Compact setting tags, with a separator between targets and properties. */
export function renderButtonCardSummary(parent: HTMLElement, label: string, tags: ButtonSummaryTag[]): void {
  parent.empty();
  parent.createSpan({ cls: "db-button-action-name", text: label });
  for (const kind of ["target", "property", "variable"] as const) {
    const all = tags.filter(tag => tag.kind === kind);
    const members = kind === "property" ? all.slice(0, 2) : all;
    if (!members.length) continue;
    const group = parent.createSpan({ cls: `db-button-summary-group is-${kind}` });
    for (const tag of members) {
      const chip = group.createSpan({ cls: "db-button-summary-tag", attr: { title: tag.text } });
      if (tag.icon && kind !== "property") renderButtonMenuIcon(chip.createSpan({ cls: "db-button-summary-tag-icon", attr: { "aria-hidden": "true" } }), tag.icon);
      chip.createSpan({ cls: "db-button-summary-tag-label", text: tag.text });
    }
    if (all.length > members.length) group.createSpan({ cls: "db-button-summary-more", text: `+${all.length - members.length}`, attr: { title: all.slice(members.length).map(tag => tag.text).join(" · ") } });
  }
  parent.title = [label, ...tags.map(tag => tag.text)].join(" · ");
}

/** Use Obsidian's complete switch (track + thumb), including keyboard/ARIA state. */
export function buttonToggle(parent: HTMLElement, label: string, value: boolean, change: (value: boolean) => void): void {
  const row = parent.createDiv({ cls: "db-modal-row db-button-toggle-row" });
  const caption = row.createEl("label", { cls: "db-modal-label", text: label });
  const toggle = new ToggleComponent(row).setValue(value).onChange(change);
  toggle.toggleEl.setAttr("aria-label", label);
  caption.onclick = () => toggle.toggleEl.click();
}

export function buttonIcon(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "db-button-quiet-icon", attr: { type: "button", "aria-label": label, title: label } });
  setIcon(button, icon);
  button.onclick = action;
  return button;
}

export function buttonAdd(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "db-button-add", attr: { type: "button" } });
  setIcon(button.createSpan(), "plus");
  button.createSpan({ text: label });
  button.onclick = action;
  return button;
}

/** Editing state follows model identities, including after reordering or rerendering. */
export class ButtonCardEditState {
  compact = false;
  private active = new WeakMap<object, unknown>();
  private collapsed = new Set<unknown>();
  isCollapsed(item: unknown): boolean { return this.collapsed.has(item); }
  setCollapsed(item: unknown, collapsed: boolean): void { if (collapsed) this.collapsed.add(item); else this.collapsed.delete(item); }
  showGlobalToggle(items: unknown[]): boolean { return !this.compact && items.length >= 3; }
  hasExpanded(items: unknown[]): boolean { return items.some(item => !this.isCollapsed(item)); }
  toggleAll(items: unknown[]): void { const collapse = this.hasExpanded(items); items.forEach(item => this.setCollapsed(item, collapse)); }
  isOpen<T>(items: T[], item: T): boolean { return this.active.get(items) === item; }
  open<T>(items: T[], item: T): void { this.active.set(items, item); this.collapsed.delete(item); }
  close(items: unknown[]): void { this.active.delete(items); }
  replace<T>(items: T[], previous: T, next: T): void { if (this.isOpen(items, previous)) this.open(items, next); }
}

export function renderButtonCardHeading<T>(card: HTMLElement, label: string, items: T[], index: number, rerender: () => void, duplicate = false, icon?: string, editing?: ButtonCardEditState): void {
  card.dataset.buttonOrder = String(index);
  const heading = card.createDiv({ cls: "db-button-action-heading" });
  let toggle: (() => void) | undefined;
  if (duplicate && editing && !editing.compact) {
    const collapsed = editing.isCollapsed(items[index]);
    if (collapsed) card.addClass("is-collapsed");
    toggle = () => {
      while (closeDropdownForRoot(card, false)) { /* Close menus before hiding their fields. */ }
      editing.setCollapsed(items[index], !editing.isCollapsed(items[index]));
      const host = card.closest<HTMLElement>(".db-button-modal");
      rerender();
      host?.querySelectorAll<HTMLElement>(".db-button-card-disclosure").forEach(button => {
        if (handleItems.get(button) === items && button.dataset.index === String(index)) button.focus({ preventScroll: true });
      });
    };
    const arrow = buttonIcon(heading, collapsed ? "chevron-right" : "chevron-down", `${t(collapsed ? "button.workflow.expand" : "button.workflow.collapse")} ${label}`, toggle);
    arrow.addClass("db-button-card-disclosure");
    arrow.setAttr("aria-expanded", String(!collapsed));
    arrow.dataset.index = String(index); handleItems.set(arrow, items);
  }
  const move = (to: number): void => {
    if (to < 0 || to >= items.length || to === index) return;
    const item = items[index];
    items.splice(index, 1); items.splice(to, 0, item);
    const scrollHost = card.closest<HTMLElement>(".db-button-modal");
    const scrollTop = scrollHost?.scrollTop || 0;
    rerender();
    if (scrollHost) {
      scrollHost.scrollTop = scrollTop;
      scrollHost.querySelectorAll<HTMLElement>(".db-button-drag-handle, .db-button-card-edit").forEach(handle => {
        if (handleItems.get(handle) === items && handle.dataset.index === String(to)) handle.focus({ preventScroll: true });
      });
    }
  };
  if (editing?.compact) {
    card.addClass("is-compact-card");
    if (editing.isOpen(items, items[index])) card.addClass("is-editing");
    const footer = card.createDiv({ cls: "db-button-card-footer" });
    const order = footer.createDiv({ cls: "db-button-card-order" });
    buttonIcon(order, "arrow-up", t("common.moveUp"), () => move(index - 1)).disabled = index === 0;
    buttonIcon(order, "arrow-down", t("common.moveDown"), () => move(index + 1)).disabled = index === items.length - 1;
    const edit = footer.createEl("button", { cls: "db-button-card-edit", text: t(editing.isOpen(items, items[index]) ? "button.workflow.doneEditing" : "common.edit"), attr: { type: "button", "aria-expanded": String(editing.isOpen(items, items[index])) } });
    edit.dataset.index = String(index); handleItems.set(edit, items);
    edit.onclick = () => {
      while (closeDropdownForRoot(card, false)) { /* Remove flyouts before hiding editors. */ }
      if (editing.isOpen(items, items[index])) editing.close(items); else editing.open(items, items[index]);
      const host = card.closest<HTMLElement>(".db-button-modal");
      rerender();
      host?.querySelectorAll<HTMLElement>(".db-button-card-edit").forEach(button => {
        if (handleItems.get(button) === items && button.dataset.index === String(index)) button.focus({ preventScroll: true });
      });
    };
  } else {
    let suppressClick = false;
    const handle = buttonIcon(heading, "grip-vertical", t("button.workflow.reorder"), () => {
      if (suppressClick) { suppressClick = false; return; }
      openDropdownMenu({ anchor: handle, label: t("panel.dragToSort"), value: "", options: [
        { value: "up", text: t("common.moveUp"), icon: "arrow-up", disabled: index === 0 },
        { value: "down", text: t("common.moveDown"), icon: "arrow-down", disabled: index === items.length - 1 },
      ], onChange: value => move(index + (value === "up" ? -1 : 1)) });
    });
    handle.addClass("db-button-drag-handle"); handle.dataset.index = String(index);
    handleItems.set(handle, items);
    handle.draggable = false;
    handle.onkeydown = event => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault(); event.stopPropagation();
      move(index + (event.key === "ArrowUp" ? -1 : 1));
    };
    const win = card.ownerDocument.defaultView!;
    const doc = card.ownerDocument;
    const feedback = new DragDropFeedbackState();
    let pointer: { id: number; type: string; x: number; y: number; startX: number; startY: number; active: boolean } | null = null;
    let target: { index: number; after: boolean } | null = null;
    let preview: HTMLElement | null = null;
    let frame = 0;
    let collapsedList: HTMLElement | null = null;
    let collapseClass = "is-sorting-actions";
    let previousMinHeight = "";
    let previousScrollTop = 0;
    const finish = (commit: boolean): void => {
      if (!pointer) return;
      const id = pointer.id;
      const destination = target;
      const wasActive = pointer.active;
      suppressClick = pointer.active;
      pointer = null; target = null;
      win.cancelAnimationFrame(frame);
      win.removeEventListener("blur", cancel);
      doc.removeEventListener("pointerup", onRelease, true);
      doc.removeEventListener("pointercancel", onPointerCancel, true);
      doc.removeEventListener("mouseup", onMouseRelease, true);
      if (collapsedList) {
        sortingCancellation.delete(collapsedList);
        if (!commit && wasActive) recentlyCancelled.set(collapsedList, Date.now());
        collapsedList.removeClass(collapseClass);
        collapsedList.style.minHeight = previousMinHeight;
        const host = card.closest<HTMLElement>(".db-button-modal");
        if (host) host.scrollTop = previousScrollTop;
        collapsedList = null;
      }
      feedback.clear(); preview?.remove(); preview = null;
      card.removeClass("is-dragging");
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      if (commit && destination) {
        let to = destination.index + (destination.after ? 1 : 0);
        if (index < to) to--;
        move(to);
      }
    };
    const cancel = (): void => finish(false);
    const onRelease = (event: PointerEvent): void => {
      if (pointer?.id === event.pointerId) { event.stopPropagation(); finish(true); }
    };
    const onPointerCancel = (event: PointerEvent): void => { if (pointer?.id === event.pointerId) cancel(); };
    const onMouseRelease = (event: MouseEvent): void => {
      if (pointer?.type === "mouse" && event.button === 0) finish(true);
    };
    const updateTarget = (): void => {
      if (!pointer?.active) return;
      target = null;
      for (const sibling of Array.from(card.parentElement?.children || [])) {
        const candidate = sibling as HTMLElement;
        if (candidate === card || candidate.dataset.buttonOrder === undefined) continue;
        const rect = candidate.getBoundingClientRect();
        if (pointer.x < rect.left || pointer.x > rect.right || pointer.y < rect.top || pointer.y > rect.bottom) continue;
        const after = pointer.y > rect.top + rect.height / 2;
        target = { index: Number(candidate.dataset.buttonOrder), after };
        feedback.update(candidate, after ? "after" : "before");
        break;
      }
      if (!target && collapsedList) {
        const candidates = Array.from(collapsedList.children).filter(child => (child as HTMLElement).dataset.buttonOrder !== undefined) as HTMLElement[];
        const nearest = candidates.reduce<HTMLElement | null>((best, candidate) => {
          const rect = candidate.getBoundingClientRect();
          if (pointer!.x < rect.left || pointer!.x > rect.right) return best;
          const distance = Math.abs(pointer!.y - rect.top - rect.height / 2);
          const bestRect = best?.getBoundingClientRect();
          return !bestRect || distance < Math.abs(pointer!.y - bestRect.top - bestRect.height / 2) ? candidate : best;
        }, null);
        if (nearest && nearest !== card) {
          const rect = nearest.getBoundingClientRect();
          // Only a small margin belongs to this list; do not accept another list's area.
          const first = candidates[0]?.getBoundingClientRect();
          const last = candidates[candidates.length - 1]?.getBoundingClientRect();
          if (first && last && pointer.y >= first.top - 20 && pointer.y <= last.bottom + 20) {
            const after = pointer.y > rect.top + rect.height / 2;
            target = { index: Number(nearest.dataset.buttonOrder), after };
            feedback.update(nearest, after ? "after" : "before");
          }
        }
      }
      if (!target) feedback.clear();
      preview?.setCssProps({ left: `${pointer.x + 14}px`, top: `${pointer.y + 14}px` });
    };
    const autoScroll = (): void => {
      if (!pointer?.active) return;
      if (!handle.isConnected) { cancel(); return; }
      const host = card.closest<HTMLElement>(".db-button-modal");
      if (host) {
        const rect = host.getBoundingClientRect();
        const delta = pointer.y < rect.top + 48 ? -8 : pointer.y > rect.bottom - 72 ? 8 : 0;
        if (delta) { host.scrollTop += delta; updateTarget(); }
      }
      frame = win.requestAnimationFrame(autoScroll);
    };
    handle.onpointerdown = event => {
      if (event.button !== 0 || pointer) return;
      event.stopPropagation();
      suppressClick = false;
      pointer = { id: event.pointerId, type: event.pointerType || "mouse", x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false };
      try { handle.setPointerCapture(event.pointerId); } catch { pointer = null; return; }
      win.addEventListener("blur", cancel);
      doc.addEventListener("pointerup", onRelease, true);
      doc.addEventListener("pointercancel", onPointerCancel, true);
      doc.addEventListener("mouseup", onMouseRelease, true);
    };
    handle.onpointermove = event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      pointer.x = event.clientX; pointer.y = event.clientY;
      if (!pointer.active && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) < 5) return;
      event.preventDefault(); event.stopPropagation();
      if (!pointer.active) {
        pointer.active = true; card.addClass("is-dragging");
        if (card.parentElement && (duplicate || card.parentElement.hasClass("db-button-property-actions"))) {
          collapsedList = card.parentElement;
          collapseClass = duplicate ? "is-sorting-actions" : "is-sorting-properties";
          sortingCancellation.set(collapsedList, cancel);
          recentlyCancelled.delete(collapsedList);
          const host = card.closest<HTMLElement>(".db-button-modal");
          previousScrollTop = host?.scrollTop || 0;
          previousMinHeight = collapsedList.style.minHeight;
          const before = card.getBoundingClientRect().top;
          collapsedList.style.minHeight = `${collapsedList.getBoundingClientRect().height}px`;
          collapsedList.addClass(collapseClass);
          // Keep the grabbed heading under the pointer while the preceding cards shrink.
          if (host) host.scrollTop += card.getBoundingClientRect().top - before;
        }
        const title = heading.querySelector<HTMLElement>(".db-button-action-title");
        preview = card.ownerDocument.body.createDiv({ cls: "db-button-drag-preview", text: title?.title || title?.textContent || label, attr: { "aria-hidden": "true" } });
        frame = win.requestAnimationFrame(autoScroll);
      }
      updateTarget();
    };
    handle.onpointerup = onRelease;
    handle.onpointercancel = onPointerCancel;
    handle.onlostpointercapture = cancel;
  }
  if (icon) renderButtonMenuIcon(heading.createSpan({ cls: "db-button-action-icon", attr: { "aria-hidden": "true" } }), icon);
  const title = heading.createSpan({ cls: "db-button-action-title", text: label });
  if (toggle && editing) {
    title.addClass("is-collapsible");
    title.setAttr("role", "button"); title.setAttr("tabindex", "0");
    title.setAttr("aria-expanded", String(!editing.isCollapsed(items[index])));
    title.onclick = () => { if (card.ownerDocument.getSelection?.()?.isCollapsed !== false) toggle(); };
    title.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggle(); }
    };
  }
  const tools = heading.createDiv({ cls: "db-button-card-tools" });
  if (duplicate) buttonIcon(tools, "copy", t("button.workflow.duplicateStep"), () => { const copy = structuredClone(items[index]); items.splice(index + 1, 0, copy); editing?.open(items, copy); const list = card.parentElement; rerender(); (list?.children[index + 1] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" }); });
  buttonIcon(tools, "trash-2", t("common.delete"), () => { items.splice(index, 1); rerender(); }).addClass("db-button-delete");
}

const handleItems = new WeakMap<HTMLElement, object>();

const sortingCancellation = new WeakMap<HTMLElement, () => void>();
const recentlyCancelled = new WeakMap<HTMLElement, number>();
/** Modal Scope owns Escape. Some hosts dispatch pointer cancellation before the key. */
export function cancelButtonSorting(list: HTMLElement | undefined): boolean {
  if (!list) return false;
  for (const candidate of [list, ...Array.from(list.querySelectorAll<HTMLElement>(".db-button-property-actions"))]) {
    const cancel = sortingCancellation.get(candidate);
    if (cancel) {
      cancel(); recentlyCancelled.delete(candidate); return true;
    }
    const cancelledAt = recentlyCancelled.get(candidate);
    recentlyCancelled.delete(candidate);
    if (cancelledAt !== undefined && Date.now() - cancelledAt < 300) return true;
  }
  return false;
}
