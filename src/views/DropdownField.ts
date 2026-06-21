import { setIcon } from "obsidian";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { positionToolbarPopover } from "./PopoverPosition";

export interface DropdownOption {
  value: string;
  text: string;
  section?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon?: string;
  swatches?: string[];
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
  closeOnSelect?: boolean;
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
  closeOnSelect?: boolean;
  renderIcon?(parent: HTMLElement, icon: string): void;
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
  if (options.icon) {
    if (options.renderIcon) options.renderIcon(iconWrap, options.icon);
    else setIcon(iconWrap, options.icon);
  }
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
        currentValue = value;
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
  let cleanup: (() => void) | undefined;
  const close = () => {
    cleanup?.();
    cleanup = undefined;
  };
  cleanup = openDropdownPopover(options.anchor, {
    parent: options.anchor,
    label: options.label,
    options: options.options,
    value: options.value,
    onChange: (value) => options.onChange(value),
    popoverClassName: options.popoverClassName,
    searchable: options.searchable,
    closeOnSelect: options.closeOnSelect,
    renderIcon: options.renderIcon ? (parent, icon) => options.renderIcon?.(parent, icon) : undefined,
  }, valueEl, close);
  return close;
}

function openDropdownPopover(anchor: HTMLElement, options: DropdownFieldOptions, valueEl: HTMLElement, close: () => void): () => void {
  const host = getDropdownPopoverHost(anchor);
  const panel = host.createDiv({ cls: `db-dropdown-popover${options.popoverClassName ? ` ${options.popoverClassName}` : ""}` });
  panel.setAttr("role", "listbox");
  const searchable = options.searchable === true && options.options.length > 8;
  let searchInput: HTMLInputElement | undefined;
  if (searchable) {
    const searchWrap = panel.createDiv({ cls: "db-dropdown-search" });
    searchInput = searchWrap.createEl("input", {
      attr: { type: "search", placeholder: options.label, "aria-label": options.label },
    });
  }
  let currentSection = "";
  let currentSectionEl: HTMLElement | undefined;
  const sectionRows: Array<{ section?: HTMLElement; row: HTMLButtonElement; value: string }> = [];
  for (const option of options.options) {
    if (option.section && option.section !== currentSection) {
      currentSection = option.section;
      currentSectionEl = panel.createDiv({ cls: "db-dropdown-section-title", text: option.section });
    }
    const row = panel.createEl("button", {
      cls: `db-dropdown-option${option.icon ? " has-icon" : ""}${option.swatches?.length ? " has-swatches" : ""}${option.value === options.value ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`,
      attr: { type: "button", role: "option", "aria-selected": option.value === options.value ? "true" : "false" },
    });
    row.setAttr("data-value", option.value);
    row.setAttr("data-search-text", `${option.text} ${option.value} ${option.disabledReason || ""}`.toLowerCase());
    row.disabled = option.disabled === true;
    if (option.disabledReason) {
      row.setAttr("title", option.disabledReason);
      row.setAttr("aria-label", `${option.text}: ${option.disabledReason}`);
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
    if (option.disabledReason) text.createSpan({ cls: "db-dropdown-option-reason", text: option.disabledReason });
    if (option.swatches?.length) {
      const swatches = row.createSpan({ cls: "db-dropdown-option-swatches", attr: { "aria-hidden": "true" } });
      for (const color of option.swatches.slice(0, 5)) {
        swatches.createSpan({ cls: "db-dropdown-option-swatch", attr: { style: `background-color: ${color}` } });
      }
    }
    row.onclick = () => {
      if (row.disabled) return;
      syncDropdownSelection(sectionRows, option.value);
      valueEl.setText(option.text);
      options.onChange(option.value);
      if (options.closeOnSelect !== false) close();
    };
    sectionRows.push({ section: currentSectionEl, row, value: option.value });
  }
  if (searchInput) {
    searchInput.oninput = () => filterDropdownOptions(sectionRows, searchInput?.value || "");
    window.setTimeout(() => searchInput?.focus(), 0);
  }
  positionToolbarPopover(panel, anchor, { preferredWidth: 280, maxWidth: 360, minWidth: 180, gap: 6 });

  const onOutside = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || anchor.contains(target))) return;
    close();
  };
  const outsideTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
  const removeAutoClose = installPopoverAutoClose({ panel, anchorEl: anchor, close });
  return () => {
    window.clearTimeout(outsideTimer);
    window.activeDocument.removeEventListener("mousedown", onOutside, true);
    removeAutoClose();
    panel.remove();
  };
}

function getDropdownPopoverHost(anchor: HTMLElement): HTMLElement {
  const container = anchor.closest(".note-database-container");
  if (container instanceof HTMLElement) return container;
  return anchor.parentElement || anchor;
}

function getOptionText(options: DropdownOption[], value: string): string | undefined {
  return options.find((option) => option.value === value)?.text;
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
