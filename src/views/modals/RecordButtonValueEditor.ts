import { setIcon } from "obsidian";
import type { ColumnDef } from "../../data/types";
import { buttonTokenValue, insertButtonToken, parseButtonText, removeButtonToken, serializeButtonText, type ButtonTextPart } from "../../data/RecordButtonComposition";
import { openDropdownMenu, type DropdownOption } from "../DropdownField";
import { getPropertyDropdownIcon } from "../PropertyTypeIcon";
import { BUTTON_FILE_VALUE_ICONS, BUTTON_STEP_ICONS, renderButtonMenuIcon } from "../RecordButtonMenuIcons";
import { t } from "../../i18n";
import { isImeComposing } from "../../data/KeyboardUtils";
import { getTextInputContentWidth } from "../TextInputCaret";

export interface ButtonValueFields { trigger: ColumnDef[]; target?: ColumnDef[]; created?: ColumnDef[] }
export function buttonTokenOptions(columns: ButtonValueFields, variables: string[]): DropdownOption[] {
  const options: DropdownOption[] = [];
  for (const scope of ["trigger", "target", "created"] as const) {
    if (!columns[scope]) continue;
    for (const field of ["file.basename", "file.body", "file.link", "file.path"]) {
      options.push({ value: `${scope}.${field}`, text: `${t(`button.workflow.target.${scope}`)} · ${t(`button.workflow.${field}`)}`, icon: BUTTON_FILE_VALUE_ICONS[field] });
    }
    for (const column of columns[scope]) {
      if (!["button", "computed", "rollup"].includes(column.type) && !column.key.startsWith("file.")) options.push({ value: `${scope}.${column.key}`, text: `${t(`button.workflow.target.${scope}`)} · ${column.label}`, icon: getPropertyDropdownIcon(column.type) });
    }
  }
  for (const value of ["today", "now"]) options.push({ value, text: t(`button.workflow.${value}`), icon: getPropertyDropdownIcon(value === "today" ? "date" : "datetime") });
  for (const name of variables) options.push({ value: `var.${name}`, text: `${t("button.workflow.variable")} · ${name}`, icon: BUTTON_STEP_ICONS.variable });
  return options;
}

/** Shared by titles, bodies, messages, links and typed dynamic property values. */
export function renderButtonComposition(parent: HTMLElement, label: string, initial: string | ButtonTextPart[], columns: ButtonValueFields, variables: string[], change: (parts: ButtonTextPart[]) => void, multiline = false, help?: string): void {
  const row = parent.createDiv({ cls: "db-modal-row db-button-composition-row" });
  row.createEl("label", { cls: "db-modal-label", text: label });
  const host = row.createDiv({ cls: "db-button-composition" });
  const surface = host.createDiv({ cls: `db-button-composition-surface${multiline ? " is-multiline" : ""}` });
  const variableButton = host.createEl("button", { cls: "db-button-insert-value", attr: { type: "button", "aria-label": t("button.workflow.insertValue"), title: t("button.workflow.composeHint") } });
  renderButtonMenuIcon(variableButton, BUTTON_STEP_ICONS.variable);
  host.createDiv({ cls: "db-button-field-help db-button-composition-hint", text: t("button.workflow.composeHint") });
  if (help) host.createDiv({ cls: "db-button-field-help", text: help });
  const options = buttonTokenOptions(columns, variables);
  let parts = typeof initial === "string" ? parseButtonText(initial) : initial;
  let selection = { index: parts.length - 1, start: parts[parts.length - 1]?.kind === "text" ? (parts[parts.length - 1] as { text: string }).text.length : 0, end: 0 };
  selection.end = selection.start;
  const inputs: Array<{ index: number; start: () => number; input: HTMLInputElement | HTMLTextAreaElement }> = [];
  let closeMenu: (() => void) | undefined;
  let restoringFocus = false;
  let activeInput: HTMLInputElement | HTMLTextAreaElement | undefined;
  let suppressAutomaticMenu = false;
  let brace: { index: number; start: number } | undefined;
  const dismissMenu = (): void => { closeMenu?.(); closeMenu = undefined; };
  const showMenu = (input: HTMLInputElement | HTMLTextAreaElement): void => {
    if (restoringFocus || closeMenu) return;
    closeMenu = openDropdownMenu({ anchor: input, label: t("button.workflow.insertValue"), value: "", options,
      followCaret: true, caretLineAnchor: surface, popoverClassName: "db-button-menu-popover", renderIcon: renderButtonMenuIcon, onChange: insert, onClose: () => { closeMenu = undefined; brace = undefined; } });
  };
  const publish = (): void => change(parts);
  const focusText = (index: number, position = 0): void => {
    const entry = inputs.filter(item => item.index === index).reverse().find(item => item.start() <= position);
    if (!entry) return;
    restoringFocus = true;
    entry.input.focus({ preventScroll: true });
    restoringFocus = false;
    entry.input.setSelectionRange(position - entry.start(), position - entry.start());
    selection = { index, start: position, end: position };
  };
  const insert = (key: string): void => {
    const index = selection.index;
    parts = insertButtonToken(parts, index, brace?.index === index && brace.start === selection.start - 1 ? brace.start : selection.start, selection.end, key);
    brace = undefined;
    publish(); render(); focusText(index + 2);
  };
  const render = (): void => {
    dismissMenu(); surface.empty(); inputs.length = 0;
    let line = multiline ? surface.createDiv({ cls: "db-button-composition-line" }) : surface;
    parts.forEach((part, index) => {
      if (part.kind === "text") {
        const lines = multiline ? part.text.split("\n") : [part.text];
        lines.forEach((text, lineIndex) => {
          if (lineIndex > 0) line = surface.createDiv({ cls: "db-button-composition-line" });
          const input = multiline ? line.createEl("textarea", { attr: { rows: "1", "aria-label": label, "aria-description": t("button.workflow.composeHint") } }) : line.createEl("input", { attr: { type: "text", "aria-label": label, "aria-description": t("button.workflow.composeHint") } });
          input.addClass("db-button-composition-text"); input.value = text;
          input.placeholder = parts.length === 1 && lines.length === 1 ? t("button.workflow.composePlaceholder") : "";
          const start = (): number => lineIndex === 0 ? 0 : part.text.split("\n").slice(0, lineIndex).join("\n").length + 1;
          const size = (): void => {
            input.style.width = `${input.value ? getTextInputContentWidth(input) + 2 : 2}px`;
            if (multiline) { input.setCssProps({ height: "auto" }); input.style.height = `${Math.max(28, input.scrollHeight)}px`; }
          };
          const remember = (): void => { selection = { index, start: start() + (input.selectionStart ?? input.value.length), end: start() + (input.selectionEnd ?? input.value.length) }; };
          input.onfocus = () => { activeInput = input; if (!restoringFocus) suppressAutomaticMenu = false; remember(); };
          input.onclick = remember;
          input.onkeyup = remember; input.onselect = remember;
          input.addEventListener("compositionstart", dismissMenu);
          input.addEventListener("compositionend", remember);
          input.onblur = dismissMenu;
          input.onkeydown = event => {
            if (event.key === "Escape" && closeMenu) { event.preventDefault(); event.stopPropagation(); suppressAutomaticMenu = true; dismissMenu(); return; }
            if (!multiline || isImeComposing(event) || input.selectionStart !== input.selectionEnd) return;
            const current = part.text.split("\n");
            const back = event.key === "Backspace" && input.selectionStart === 0 && lineIndex > 0;
            const forward = event.key === "Delete" && input.selectionStart === input.value.length && lineIndex < current.length - 1;
            if (!back && !forward) return;
            event.preventDefault();
            const position = back ? start() - 1 : start() + input.value.length;
            const joinAt = back ? lineIndex - 1 : lineIndex;
            current.splice(joinAt, 2, current[joinAt] + current[joinAt + 1]);
            part.text = current.join("\n"); publish(); render(); focusText(index, position);
          };
          input.oninput = event => {
            const previous = part.text;
            remember();
            const current = multiline ? part.text.split("\n") : [part.text]; current[lineIndex] = input.value; part.text = current.join("\n");
            publish(); size();
            if (multiline && input.value.includes("\n") && !(event && "isComposing" in event && event.isComposing)) {
              const position = selection.start; render(); focusText(index, position);
            } else if (!(event && "isComposing" in event && event.isComposing)) {
              const position = selection.start;
              if (!suppressAutomaticMenu && part.text !== previous && part.text[position - 1] === "{" && selection.start === selection.end) {
                dismissMenu(); brace = { index, start: position - 1 }; showMenu(input);
              } else if (closeMenu) dismissMenu();
            }
          };
          inputs.push({ index, start, input }); size();
        });
      } else {
        const date = buttonTokenValue(part.key);
        const missing = date && ["trigger", "target", "created"].includes(date.source)
          ? `${t(`button.workflow.target.${date.source}`)} · ${String(date.value).startsWith("file.") ? t(`button.workflow.${String(date.value)}`) : String(date.value)}`
          : date?.source === "variable" ? `${t("button.workflow.variable")} · ${String(date.value)}` : part.key;
        const title = options.find(option => option.value === part.key)?.text || (date?.source === "date" ? t("button.workflow.relativeDate", { date: t(`button.workflow.${String(date.value)}`), days: String(date.offsetDays) }) : t("button.workflow.unavailableToken", { value: missing }));
        const chip = line.createSpan({ cls: "db-button-value-chip", attr: { title } });
        renderButtonMenuIcon(chip.createSpan({ cls: "db-button-value-chip-icon", attr: { "aria-hidden": "true" } }), BUTTON_STEP_ICONS.variable);
        chip.createSpan({ text: title });
        const remove = chip.createEl("button", { attr: { type: "button", "aria-label": t("button.workflow.removeToken", { value: title }) } });
        setIcon(remove, "x");
        remove.onclick = () => {
          const prefix = serializeButtonText(parts.slice(0, index));
          parts = removeButtonToken(parts, index); publish(); render();
          // The two text slots surrounding the removed chip become one.
          const preceding = parseButtonText(prefix);
          const textIndex = preceding.length - 1;
          focusText(textIndex, (preceding[textIndex] as { text: string }).text.length);
        };
      }
    });
  };
  surface.onclick = event => {
    if (event.target === surface || (event.target instanceof HTMLElement && event.target.hasClass("db-button-composition-line"))) {
      const input = inputs[inputs.length - 1]?.input;
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  };
  variableButton.onmousedown = event => event.preventDefault();
  variableButton.onclick = () => {
    const input = activeInput && inputs.some(entry => entry.input === activeInput) ? activeInput : inputs[inputs.length - 1]?.input;
    if (!input) return;
    input.focus({ preventScroll: true });
    showMenu(input);
  };
  render();
}
