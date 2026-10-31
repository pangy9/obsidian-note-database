import { setIcon } from "obsidian";
import { suppressClickWhileTextSelected } from "./modals/ModalDrag";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { positionToolbarPopover } from "./PopoverPosition";
import { getTextInputCaretRect } from "./TextInputCaret";
import { isImeComposing } from "../data/KeyboardUtils";

export interface DropdownOption {
  value: string;
  text: string;
  /** Secondary explanatory text; shown in the row and as a native hover tooltip. */
  description?: string;
  section?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon?: string;
  swatches?: string[];
  /** Action row that invokes onChange without replacing the field's current displayed value. */
  preserveValueOnSelect?: boolean;
}

export interface DropdownFieldOptions {
  parent: HTMLElement;
  label: string;
  options: DropdownOption[];
  value: string;
  onChange(value: string): void;
  icon?: string;
  className?: string;
  popoverClassName?: string;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
  hideLabel?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  closeOnSelect?: boolean;
  followCaret?: boolean;
  caretLineAnchor?: HTMLElement;
  renderIcon?(parent: HTMLElement, icon: string): void;
}

export interface DropdownFieldHandle {
  button: HTMLButtonElement;
  valueEl: HTMLElement;
  close(): void;
}

export interface DropdownMenuOptions {
  anchor: HTMLElement;
  label: string;
  options: DropdownOption[];
  value: string;
  onChange(value: string): void;
  popoverClassName?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  closeOnSelect?: boolean;
  followCaret?: boolean;
  caretLineAnchor?: HTMLElement;
  renderIcon?(parent: HTMLElement, icon: string): void;
  onClose?: () => void;
}

export function createDropdownField(options: DropdownFieldOptions): DropdownFieldHandle {
  let currentValue = options.value;
  const button = options.parent.createEl("button", {
    cls: `db-dropdown-field${options.className ? ` ${options.className}` : ""}`,
    attr: { type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" },
  });
  if (options.disabled) button.disabled = true;
  if (options.disabledReason) {
    button.setAttr("title", options.disabledReason);
    button.setAttr("aria-label", `${options.label}: ${options.disabledReason}`);
  }
  const iconWrap = button.createSpan({ cls: "db-dropdown-field-icon" });
  const renderButtonIcon = (value: string) => {
    iconWrap.empty();
    const icon = options.icon || getOptionIcon(options.options, value);
    button.toggleClass("has-current-icon", Boolean(icon));
    if (!icon) return;
    if (options.renderIcon) options.renderIcon(iconWrap, icon);
    else setIcon(iconWrap, icon);
  };
  renderButtonIcon(currentValue);
  const text = button.createDiv({ cls: "db-dropdown-field-text" });
  if (!options.hideLabel) text.createSpan({ cls: "db-dropdown-field-label", text: options.label });
  const valueEl = text.createSpan({ cls: "db-dropdown-field-value", text: getOptionText(options.options, currentValue) || options.placeholder || "" });
  if (options.disabled && options.disabledReason) {
    text.createSpan({ cls: "db-dropdown-field-disabled-reason", text: options.disabledReason });
  }
  setIcon(button.createSpan({ cls: "db-dropdown-field-chevron" }), "chevron-down");

  let cleanup: (() => void) | undefined;
  const close = () => {
    cleanup?.();
    cleanup = undefined;
    button.setAttr("aria-expanded", "false");
  };
  button.onclick = () => {
    if (button.disabled) return;
    if (cleanup) {
      close();
      return;
    }
    cleanup = openDropdownPopover(button, {
      ...options,
      value: currentValue,
      onChange: (value) => {
        const action = options.options.find((option) => option.value === value)?.preserveValueOnSelect === true;
        if (!action) {
          currentValue = value;
          renderButtonIcon(currentValue);
        }
        options.onChange(value);
      },
    }, valueEl, close);
    button.setAttr("aria-expanded", "true");
  };
  return { button, valueEl, close };
}

export function openDropdownMenu(options: DropdownMenuOptions): () => void {
  const doc = options.anchor.ownerDocument;
  const valueEl = doc.createElement("span");
  let closed = false;
  let cleanup: (() => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    cleanup?.();
    cleanup = undefined;
    options.onClose?.();
  };
  cleanup = openDropdownPopover(options.anchor, {
    parent: options.anchor,
    label: options.label,
    options: options.options,
    value: options.value,
    onChange: (value) => options.onChange(value),
    popoverClassName: options.popoverClassName,
    searchable: options.searchable,
    searchPlaceholder: options.searchPlaceholder,
    closeOnSelect: options.closeOnSelect,
    followCaret: options.followCaret,
    caretLineAnchor: options.caretLineAnchor,
    renderIcon: options.renderIcon ? (parent, icon) => options.renderIcon?.(parent, icon) : undefined,
  }, valueEl, close);
  return close;
}

const openDropdowns = new WeakMap<HTMLElement, { anchor: HTMLElement; close: () => void }>();

/** Let a modal consume Escape for its own body-hosted dropdown before closing itself. */
export function closeDropdownForRoot(root: HTMLElement, restoreFocus = true): boolean {
  const panels = Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(".db-dropdown-popover")).reverse();
  for (const panel of panels) {
    const entry = openDropdowns.get(panel);
    if (!entry || !root.contains(entry.anchor)) continue;
    entry.close();
    if (restoreFocus && entry.anchor.isConnected) entry.anchor.focus({ preventScroll: true });
    return true;
  }
  return false;
}

function openDropdownPopover(anchor: HTMLElement, options: DropdownFieldOptions, valueEl: HTMLElement, close: () => void): () => void {
  const contextClass = getDropdownPopoverContextClass(anchor);
  const host = getDropdownPopoverHost(anchor);
  const searchable = options.searchable === true && options.options.length > 8;
  const panel = host.createDiv({ cls: `db-dropdown-popover ${contextClass}${searchable ? " is-searchable" : ""}${options.popoverClassName ? ` ${options.popoverClassName}` : ""}` });
  openDropdowns.set(panel, { anchor, close });
  // 拖选选项文字可复制；拖选后的 click 不触发选择项。
  suppressClickWhileTextSelected(panel);
  panel.setAttr("role", "listbox");
  let searchInput: HTMLInputElement | undefined;
  if (searchable) {
    const searchWrap = panel.createDiv({ cls: "db-dropdown-search" });
    searchInput = searchWrap.createEl("input", {
      attr: { type: "search", placeholder: options.searchPlaceholder || options.label, "aria-label": options.label },
    });
  }
  // When searchable, options live in their own scroll container so the search box stays
  // fixed at the top (no sticky drift). Otherwise the panel itself scrolls.
  const optionsHost = searchable ? panel.createDiv({ cls: "db-dropdown-options" }) : panel;
  let currentSection = "";
  let currentSectionEl: HTMLElement | undefined;
  const sectionRows: Array<{ section?: HTMLElement; row: HTMLButtonElement; value: string }> = [];
  for (const option of options.options) {
    if (option.section && option.section !== currentSection) {
      currentSection = option.section;
      currentSectionEl = optionsHost.createDiv({ cls: "db-dropdown-section-title", text: option.section });
    }
    const row = optionsHost.createEl("button", {
      cls: `db-dropdown-option${option.icon ? " has-icon" : ""}${option.swatches?.length ? " has-swatches" : ""}${option.value === options.value ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`,
      attr: { type: "button", role: "option", "aria-selected": option.value === options.value ? "true" : "false" },
    });
    row.setAttr("data-value", option.value);
    row.setAttr("data-search-text", `${option.text} ${option.value} ${option.description || option.disabledReason || ""}`.toLowerCase());
    row.disabled = option.disabled === true;
    if (option.disabledReason) {
      row.setAttr("title", option.disabledReason);
      row.setAttr("aria-label", `${option.text}: ${option.disabledReason}`);
    } else {
      row.setAttr("title", option.description || option.text);
    }
    const check = row.createSpan({ cls: "db-dropdown-option-check" });
    if (option.value === options.value) setIcon(check, "check");
    if (option.icon) {
      const iconEl = row.createSpan({ cls: "db-dropdown-option-icon" });
      if (options.renderIcon) options.renderIcon(iconEl, option.icon);
      else setIcon(iconEl, option.icon);
    }
    const text = row.createSpan({ cls: "db-dropdown-option-text" });
    text.createSpan({ cls: "db-dropdown-option-label", text: option.text });
    if (option.description || option.disabledReason) text.createSpan({ cls: "db-dropdown-option-reason", text: option.description || option.disabledReason });
    if (option.swatches?.length) {
      const swatches = row.createSpan({ cls: "db-dropdown-option-swatches", attr: { "aria-hidden": "true" } });
      for (const color of option.swatches.slice(0, 5)) {
        swatches.createSpan({ cls: "db-dropdown-option-swatch", attr: { style: `background-color: ${color}` } });
      }
    }
    row.onclick = () => {
      if (row.disabled) return;
      if (!option.preserveValueOnSelect) {
        syncDropdownSelection(sectionRows, option.value);
        valueEl.setText(option.text);
      }
      options.onChange(option.value);
      if (options.closeOnSelect !== false) close();
    };
    sectionRows.push({ section: currentSectionEl, row, value: option.value });
  }
  if (searchInput) {
    searchInput.oninput = () => filterDropdownOptions(sectionRows, searchInput?.value || "");
    window.setTimeout(() => searchInput?.focus(), 0);
  }
  const place = () => positionToolbarPopover(panel, anchor, {
    preferredWidth: 280, maxWidth: 360, minWidth: 180, maxHeight: options.followCaret ? 240 : 360, gap: 6,
    ...(options.followCaret ? { align: "left" as const, getAnchorRect: () => {
      const caret = getTextInputCaretRect(anchor as HTMLInputElement | HTMLTextAreaElement);
      return options.caretLineAnchor ? new DOMRect(options.caretLineAnchor.getBoundingClientRect().left, caret.y, 1, caret.height) : caret;
    } } : {}),
  });
  place();
  const preventFocusLoss = (event: MouseEvent) => event.preventDefault();
  let activeIndex = -1;
  const onAnchorKeydown = (event: KeyboardEvent) => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    const rows = sectionRows.filter(item => !item.row.disabled && !item.row.hasClass("is-hidden"));
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault(); event.stopPropagation(); rows[activeIndex]?.row.click(); return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key) || !rows.length) return;
    event.preventDefault(); event.stopPropagation();
    activeIndex = Math.max(0, Math.min(rows.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
    rows.forEach((item, index) => item.row.toggleClass("is-selected", index === activeIndex));
    rows[activeIndex].row.scrollIntoView({ block: "nearest" });
  };
  const onScroll = (event: Event) => { if (!panel.contains(event.target as Node)) place(); };
  if (options.followCaret) {
    panel.addEventListener("mousedown", preventFocusLoss);
    anchor.addEventListener("keydown", onAnchorKeydown);
    for (const type of ["input", "keyup", "click", "select"]) anchor.addEventListener(type, place);
    anchor.ownerDocument.addEventListener("scroll", onScroll, true);
    anchor.ownerDocument.defaultView?.addEventListener("resize", place);
  }

  // The search box stays fixed; only the options list scrolls.
  if (searchable) panel.setCssProps({ overflowY: "hidden" });

  const onOutside = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || anchor.contains(target))) return;
    close();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
    anchor.focus();
  };
  const outsideTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
  panel.addEventListener("keydown", onKeydown);
  const removeAutoClose = installPopoverAutoClose({ panel, anchorEl: anchor, close });
  return () => {
    window.clearTimeout(outsideTimer);
    window.activeDocument.removeEventListener("mousedown", onOutside, true);
    if (options.followCaret) {
      panel.removeEventListener("mousedown", preventFocusLoss);
      anchor.removeEventListener("keydown", onAnchorKeydown);
      for (const type of ["input", "keyup", "click", "select"]) anchor.removeEventListener(type, place);
      anchor.ownerDocument.removeEventListener("scroll", onScroll, true);
      anchor.ownerDocument.defaultView?.removeEventListener("resize", place);
    }
    openDropdowns.delete(panel);
    panel.removeEventListener("keydown", onKeydown);
    removeAutoClose();
    panel.remove();
  };
}

function getDropdownPopoverHost(anchor: HTMLElement): HTMLElement {
  if (anchor.closest(".note-database-settings, .note-database-modal")) return anchor.ownerDocument.body;
  const container = anchor.closest(".note-database-container");
  if (container instanceof HTMLElement) return container;
  return anchor.parentElement || anchor;
}

function getDropdownPopoverContextClass(anchor: HTMLElement): string {
  if (anchor.closest(".note-database-settings")) return "db-dropdown-popover-context-settings";
  if (anchor.closest(".note-database-modal")) return "db-dropdown-popover-context-modal";
  return "db-dropdown-popover-context-container";
}

function getOptionText(options: DropdownOption[], value: string): string | undefined {
  return options.find((option) => option.value === value)?.text;
}

function getOptionIcon(options: DropdownOption[], value: string): string | undefined {
  return options.find((option) => option.value === value)?.icon;
}

function syncDropdownSelection(rows: Array<{ row: HTMLButtonElement; value: string }>, value: string): void {
  for (const item of rows) {
    const selected = item.value === value;
    item.row.toggleClass("is-selected", selected);
    item.row.setAttr("aria-selected", selected ? "true" : "false");
    const check = item.row.querySelector<HTMLElement>(".db-dropdown-option-check");
    check?.replaceChildren();
    if (selected && check) setIcon(check, "check");
  }
}

function filterDropdownOptions(rows: Array<{ section?: HTMLElement; row: HTMLButtonElement }>, query: string): void {
  const normalized = query.trim().toLowerCase();
  for (const item of rows) {
    const matches = !normalized || (item.row.getAttribute("data-search-text") || "").includes(normalized);
    item.row.toggleClass("is-hidden", !matches);
  }
  const sections = Array.from(new Set(rows.map((item) => item.section).filter((item): item is HTMLElement => item != null)));
  for (const section of sections) {
    const hasVisibleRow = rows.some((item) => item.section === section && !item.row.hasClass("is-hidden"));
    section.toggleClass("is-hidden", !hasVisibleRow);
  }
}
