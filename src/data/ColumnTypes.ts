import { t } from "../i18n";
import { stringifyValue } from "./Stringify";
import { ColumnDef, StatusColor, StatusOptionDef, StatusPresetDef } from "./types";

export const STATUS_OPTION_PRESETS: Array<{ key: string; label: string; options: StatusOptionDef[] }> = [
  {
    key: "general",
    label: "通用状态",
    options: [
      { value: "未开始", color: "gray" },
      { value: "进行中", color: "blue" },
      { value: "已完成", color: "green" },
    ],
  },
  {
    key: "task",
    label: "任务状态",
    options: [
      { value: "待处理", color: "gray" },
      { value: "进行中", color: "blue" },
      { value: "受阻", color: "orange" },
      { value: "已完成", color: "green" },
      { value: "已取消", color: "red" },
    ],
  },
  {
    key: "reading",
    label: "阅读状态",
    options: [
      { value: "待读", color: "gray" },
      { value: "阅读中", color: "blue" },
      { value: "已读", color: "green" },
      { value: "暂停", color: "orange" },
      { value: "放弃", color: "red" },
    ],
  },
  {
    key: "review",
    label: "审核状态",
    options: [
      { value: "待审核", color: "gray" },
      { value: "审核中", color: "blue" },
      { value: "已通过", color: "green" },
      { value: "已拒绝", color: "red" },
    ],
  },
];

export const DEFAULT_STATUS_OPTIONS: StatusOptionDef[] = STATUS_OPTION_PRESETS[0].options;
export const DEFAULT_STATUS_PRESET_ID = STATUS_OPTION_PRESETS[0].key;

export function cloneStatusOptions(options: StatusOptionDef[] | undefined): StatusOptionDef[] {
  return (options || []).map((option) => ({
    value: String(option.value || "").trim(),
    color: option.color || "gray",
  })).filter((option) => option.value.length > 0);
}

export function getBuiltinStatusPresets(): StatusPresetDef[] {
  return STATUS_OPTION_PRESETS.map((preset) => ({
    id: preset.key,
    name: preset.label,
    options: cloneStatusOptions(preset.options),
  }));
}

export function normalizeStatusPresets(presets: unknown, fallback: StatusPresetDef[] = getBuiltinStatusPresets()): StatusPresetDef[] {
  if (!Array.isArray(presets)) return fallback.map((preset) => cloneStatusPreset(preset));
  const normalized: StatusPresetDef[] = [];
  const seen = new Set<string>();
  for (const item of presets) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const name = stringifyValue(raw["name"] ?? raw["label"]).trim();
    const id = stringifyValue(raw["id"] ?? raw["key"]).trim() || createStatusPresetId(name || "preset", normalized.length);
    const options = cloneStatusOptions(raw["options"] as StatusOptionDef[] | undefined);
    if (!name || options.length === 0 || seen.has(id)) continue;
    normalized.push({ id, name, options });
    seen.add(id);
  }
  return normalized.length ? normalized : fallback.map((preset) => cloneStatusPreset(preset));
}

export function cloneStatusPreset(preset: StatusPresetDef): StatusPresetDef {
  return {
    id: preset.id,
    name: preset.name,
    options: cloneStatusOptions(preset.options),
  };
}

export function resolveDefaultStatusPresetId(presets: StatusPresetDef[], preferred?: string): string {
  if (preferred && presets.some((preset) => preset.id === preferred)) return preferred;
  if (presets.some((preset) => preset.id === DEFAULT_STATUS_PRESET_ID)) return DEFAULT_STATUS_PRESET_ID;
  return presets[0]?.id || DEFAULT_STATUS_PRESET_ID;
}

export function getStatusPresetOptions(presets: StatusPresetDef[], preferred?: string): StatusOptionDef[] {
  const id = resolveDefaultStatusPresetId(presets, preferred);
  const preset = presets.find((candidate) => candidate.id === id) || presets[0];
  return cloneStatusOptions(preset?.options || DEFAULT_STATUS_OPTIONS);
}

function createStatusPresetId(name: string, index: number): string {
  return `${name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || "preset"}-${index + 1}`;
}

export function COLUMN_TYPE_LABELS(): Record<ColumnDef["type"], string> {
  return {
    text: t("columnType.text"),
    number: t("columnType.number"),
    date: t("columnType.date"),
    datetime: t("columnType.datetime"),
    currency: t("columnType.currency"),
    select: t("columnType.select"),
    "multi-select": t("columnType.multiSelect"),
    status: t("columnType.status"),
    checkbox: t("columnType.checkbox"),
    computed: t("columnType.computed"),
  };
}

export const OPTION_COLORS: StatusColor[] = [
  "blue", "green", "orange", "purple", "pink", "yellow", "red", "brown",
  "gray", "teal", "cyan", "lime", "indigo", "violet", "rose", "slate",
];

export function isOptionColumnType(type: ColumnDef["type"]): boolean {
  return type === "select" || type === "multi-select" || type === "status";
}

export function getColumnOptions(col: ColumnDef): StatusOptionDef[] {
  return col.statusOptions?.length ? col.statusOptions : [];
}

export function getColumnOptionValues(col?: ColumnDef): string[] {
  if (!col || !isOptionColumnType(col.type)) return [];
  const values = getColumnOptions(col).map((option) => option.value);
  if (!isObsidianTagsKey(col.key)) return values;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = normalizeObsidianTagValue(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

export function getDefaultCellValue(col: ColumnDef): unknown {
  if (col.type === "checkbox") return false;
  if (col.type === "multi-select") return [];
  if (isOptionColumnType(col.type)) return getColumnOptions(col)[0]?.value || "";
  return "";
}

export function toMultiSelectValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item).trim()).filter(Boolean);
  }
  if (value == null || value === "") return [];
  return stringifyValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isObsidianTagsKey(key: string): boolean {
  return key === "tags";
}

/** `aliases` is an Obsidian built-in multitext/list property (like `tags`). Unlike tags it
 *  has no inline-source fusion and no nesting, so it is treated as a regular multi-select
 *  list (comma-split via `toMultiSelectValues`, no `#` stripping). */
export function isObsidianAliasesKey(key: string): boolean {
  return key === "aliases";
}

export function normalizeObsidianTagValue(value: unknown): string {
  return stringifyValue(value).trim().replace(/^#/, "");
}

export interface ObsidianTagValidationResult {
  valid: boolean;
  value: string;
}

export function validateObsidianTagValue(value: unknown): ObsidianTagValidationResult {
  const tag = normalizeObsidianTagValue(value);
  if (!tag) return { valid: false, value: tag };
  if (/\s/.test(tag)) return { valid: false, value: tag };
  if (/^\d+$/.test(tag)) return { valid: false, value: tag };
  if (!/^[\p{L}\p{N}_\-/]+$/u.test(tag)) return { valid: false, value: tag };
  return { valid: true, value: tag };
}

export function normalizeValidObsidianTagValue(value: unknown): string | null {
  const result = validateObsidianTagValue(value);
  return result.valid ? result.value : null;
}

export function toValidObsidianTagValues(value: unknown): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of getObsidianTagInputEntries(value)) {
    const tag = normalizeValidObsidianTagValue(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    values.push(tag);
  }
  return values;
}

export function getInvalidObsidianTagValues(value: unknown): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of getObsidianTagInputEntries(value)) {
    const result = validateObsidianTagValue(raw);
    if (result.valid || !result.value || seen.has(result.value)) continue;
    seen.add(result.value);
    values.push(result.value);
  }
  return values;
}

function getObsidianTagInputEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [value];
}

export function toObsidianTagValues(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value == null || value === ""
      ? []
      : stringifyValue(value).split(/[,\s]+/);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of rawValues) {
    const tag = normalizeObsidianTagValue(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    values.push(tag);
  }
  return values;
}

export function hasObsidianTagValue(values: readonly string[], value: unknown): boolean {
  const expected = normalizeObsidianTagValue(value);
  return !!expected && values.some((tag) => tag === expected || tag.startsWith(`${expected}/`));
}

export function toMultiSelectValuesForKey(key: string, value: unknown): string[] {
  return isObsidianTagsKey(key) ? toObsidianTagValues(value) : toMultiSelectValues(value);
}

export function normalizeOptionValueForKey(key: string, value: unknown): string {
  return isObsidianTagsKey(key) ? normalizeObsidianTagValue(value) : stringifyValue(value).trim();
}

export function toBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = stringifyValue(value).trim().toLowerCase();
  return ["true", "yes", "y", "1", "on", "checked", "是", "已勾选"].includes(normalized);
}

export function createOptionsFromValues(values: unknown[]): StatusOptionDef[] {
  const seen = new Set<string>();
  const options: StatusOptionDef[] = [];
  for (const value of values) {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      if (part == null || part === "") continue;
      const text = stringifyValue(part).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      options.push({ value: text, color: OPTION_COLORS[options.length % OPTION_COLORS.length] });
    }
  }
  return options;
}
