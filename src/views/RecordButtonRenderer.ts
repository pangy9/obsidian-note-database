import { Notice, setTooltip } from "obsidian";
import type { ColumnDef, RowData } from "../data/types";
import { t } from "../i18n";
import { renderRecordButtonIcon } from "./RecordButtonAppearance";

export type RunRecordButton = (row: RowData, column: ColumnDef) => Promise<void>;
const locks = new WeakMap<object, Set<string>>();

export function isRecordButtonRunning(owner: object): boolean { return (locks.get(owner)?.size || 0) > 0; }

/** Shared across full and embedded views using the same data source. */
export async function withRecordButtonLock(owner: object, path: string, run: () => Promise<void>): Promise<void> {
  let paths = locks.get(owner);
  if (!paths) { paths = new Set(); locks.set(owner, paths); }
  if (paths.has(path)) return;
  paths.add(path);
  try { await run(); } finally { paths.delete(path); }
}

export function renderRecordButton(parent: HTMLElement, row: RowData, column: ColumnDef, run?: RunRecordButton, readonly = false): void {
  const config = column.buttonConfig;
  const label = config?.label || column.label;
  const button = parent.createEl("button", { cls: "db-record-button", attr: { type: "button", "aria-label": label } });
  if (config?.style === "primary") button.addClass("is-primary");
  if (config?.style === "plain") button.addClass("is-plain");
  if (config?.icon) renderRecordButtonIcon(button.createSpan({ cls: "db-record-button-icon" }), config.icon);
  button.createSpan({ cls: "db-record-button-label", text: label });
  button.disabled = readonly || !run || !(config?.steps?.length || config?.actions?.length);
  const unavailable = readonly ? t("notice.editInFullView", { action: t("button.run") }) : t("button.configureFirst");
  setTooltip(button, button.disabled ? `${label}\n${unavailable}` : label);
  for (const name of ["mousedown", "pointerdown", "dblclick"] as const) button.addEventListener(name, (event) => event.stopPropagation());
  button.addEventListener("keydown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    if (button.disabled || event.detail > 1 || !run) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    void run(row, column).catch((error: unknown) => {
      console.error("Note Database: button execution failed", error);
      new Notice(t("errors.updateFailed", { error: String(error) }));
    }).finally(() => {
      button.disabled = readonly || !(config?.steps?.length || config?.actions?.length);
      button.removeAttribute("aria-busy");
    });
  });
}
