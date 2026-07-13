import { getIconIds, setIcon, setTooltip } from "obsidian";
import { parseRecordIconToken } from "../data/RecordIcon";

let validIconIds: Set<string> | undefined;

function getValidIconIdSet(): Set<string> {
  if (validIconIds) return validIconIds;
  try {
    validIconIds = new Set<string>(getIconIds());
  } catch {
    validIconIds = new Set<string>();
  }
  return validIconIds;
}

export function renderRecordIcon(
  parent: HTMLElement,
  token: unknown,
  options: { compact?: boolean; editable?: boolean; tooltip?: string; defaultIcon?: string; onClick?: (anchor: HTMLElement) => void } = {},
): HTMLElement {
  const parsed = parseRecordIconToken(token, getValidIconIdSet());
  const button = parent.createSpan({
    cls: `db-record-icon${options.compact ? " is-compact" : ""}${parsed ? "" : " is-default"}${options.editable ? " is-editable" : ""}`,
    attr: options.editable ? { role: "button", tabindex: "0" } : {},
  });
  if (parsed?.kind === "emoji") {
    button.createSpan({ cls: "db-record-icon-emoji", text: parsed.emoji });
  } else {
    const icon = parsed?.kind === "lucide" ? parsed.icon : options.defaultIcon || "file-text";
    setIcon(button, icon);
    if (parsed?.kind === "lucide") button.addClass(`db-record-icon-color-${parsed.color}`);
  }
  if (options.tooltip) setTooltip(button, options.tooltip, { delay: 100 });
  if (options.editable && options.onClick) {
    button.onmousedown = (event) => event.stopPropagation();
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onClick?.(button);
    };
    button.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      options.onClick?.(button);
    };
  }
  return button;
}

export function getValidRecordIconIds(): string[] {
  return Array.from(getValidIconIdSet()).sort((a, b) => a.localeCompare(b));
}
