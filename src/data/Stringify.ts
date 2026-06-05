export function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  if (Array.isArray(value)) return value.map((item) => stringifyValue(item)).join(", ");
  try {
    return JSON.stringify(value) || "";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export function stringifyOptional(value: unknown): string | undefined {
  return value == null ? undefined : stringifyValue(value);
}
