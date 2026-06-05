import { stringifyValue } from "../data/Stringify";

export function formatFieldTooltipValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => formatFieldTooltipValue(entry)).filter(Boolean).join(", ");
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return stringifyValue(value);
    }
  }
  return stringifyValue(value);
}

export function setFieldTooltip(el: HTMLElement, value: unknown, prefix?: string): void {
  const text = formatFieldTooltipValue(value).trim();
  if (!text) return;
  el.title = prefix ? `${prefix}\n${text}` : text;
}
