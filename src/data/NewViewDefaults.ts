import { normalizeTimelineDayScale } from "./CalendarTimelineModel";
import { CHART_PRESET_PALETTES } from "./ChartPalettes";
import { isRecord } from "./SafeString";
import type { DatabaseConfig, DatabaseViewType, ViewConfig } from "./types";

const bool = (value: unknown) => typeof value === "boolean";
const oneOf = (...values: (number | string)[]) => (value: unknown) => values.some(candidate => candidate === value);
const pixels = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const ratio = oneOf(0.6, 0.75, 1, 1.333, 1.777);
const fit = oneOf("cover", "contain");

export const CREATION_DEFAULT_VIEW_TYPES = ["table", "board", "gallery", "list", "calendar", "timeline", "chart"] as const;

const shared = {
  showEmptyFields: { base: false, valid: bool, views: ["board", "gallery", "list", "calendar", "timeline"] },
  showRecordIcon: { base: false, valid: bool, views: ["table", "board", "gallery", "list", "calendar", "timeline"] },
  yearDisplayMode: { base: "always", valid: oneOf("always", "smart", "never"), views: ["table", "board", "gallery", "list", "calendar", "timeline", "chart"] },
} as const;

const specific = {
  defaultColumnWidth: { base: 150, valid: pixels(80, 800), views: ["table"] },
  boardColumnWidth: { base: 280, valid: pixels(220, 520), views: ["board"] },
  boardImageFit: { base: "cover", valid: fit, views: ["board"] },
  boardImageAspectRatio: { base: 0.75, valid: ratio, views: ["board"] },
  galleryCardSize: { base: 250, valid: pixels(160, 420), views: ["gallery"] },
  galleryImageFit: { base: "cover", valid: fit, views: ["gallery"] },
  galleryImageAspectRatio: { base: 0.75, valid: ratio, views: ["gallery"] },
  listCompactFields: { base: false, valid: bool, views: ["list"] },
  calendarScale: { base: "month", valid: oneOf("month", "week", "day"), views: ["calendar"] },
  calendarFirstDayOfWeek: { base: undefined, valid: oneOf(0, 1, 6), views: ["calendar"] },
  calendarWeekSlotDuration: { base: 30, valid: oneOf(15, 30, 60), views: ["calendar"] },
  timelineScale: { base: "week", valid: oneOf("day", "week", "month", "quarter"), views: ["timeline"] },
  timelineContinuous: { base: false, valid: bool, views: ["timeline"] },
  chartColorPalette: { base: "auto", valid: oneOf("auto", "accent", "option", ...Object.keys(CHART_PRESET_PALETTES)), views: ["chart"] },
  chartShowTitle: { base: true, valid: bool, views: ["chart"] },
  chartGridLines: { base: "value", valid: oneOf("none", "value", "both"), views: ["chart"] },
  chartAxisNames: { base: "none", valid: oneOf("none", "x", "y", "both"), views: ["chart"] },
  chartShowLegend: { base: true, valid: bool, views: ["chart"] },
  chartShowDataLabels: { base: false, valid: bool, views: ["chart"] },
} as const;

const fields = { ...shared, ...specific };
export type SharedDefaultKey = keyof typeof shared;
export type ViewDefaultKey = keyof typeof fields;
export type CreationDefaultKey = ViewDefaultKey | "quickFormEnabled";
export type CreationDefaultGroup = "database" | "shared" | Exclude<DatabaseViewType, "form">;
export type NewViewDisplayWidth = NonNullable<ViewConfig["displayWidth"]>;
// Toolbar preferences live alongside shared defaults, but are edited outside the popover.
type SharedValues = Partial<Pick<ViewConfig, SharedDefaultKey | "displayWidth">>;
type ViewValues = Partial<Pick<ViewConfig, ViewDefaultKey>>;
export interface NewViewDefaults {
  database: Pick<DatabaseConfig, "quickFormEnabled">;
  shared: SharedValues;
  views: Partial<Record<DatabaseViewType, ViewValues>>;
}

const sharedKeys = Object.keys(shared) as SharedDefaultKey[];
const fieldKeys = Object.keys(fields) as ViewDefaultKey[];
export function isSharedDefault(key: CreationDefaultKey): key is SharedDefaultKey {
  return Object.prototype.hasOwnProperty.call(shared, key);
}
export function getDefaultKeys(group: CreationDefaultGroup): CreationDefaultKey[] {
  if (group === "database") return ["quickFormEnabled"];
  if (group === "shared") return sharedKeys;
  return fieldKeys.filter(key => (fields[key].views as readonly DatabaseViewType[]).includes(group));
}

function readValues<T extends ViewDefaultKey>(raw: unknown, keys: readonly T[]): Partial<Pick<ViewConfig, T>> {
  const result: Partial<Pick<ViewConfig, T>> = {};
  if (!isRecord(raw)) return result;
  for (const key of keys) if (fields[key].valid(raw[key])) Object.assign(result, { [key]: raw[key] });
  return result;
}

export function normalizeNewViewDefaults(value: unknown): NewViewDefaults {
  const raw = isRecord(value) ? value : {};
  const rawViews = isRecord(raw.views) ? raw.views : {};
  const database = isRecord(raw.database) && typeof raw.database.quickFormEnabled === "boolean"
    ? { quickFormEnabled: raw.database.quickFormEnabled } : {};
  const sharedValues: SharedValues = readValues(raw.shared, sharedKeys);
  const width = isRecord(raw.shared) ? raw.shared.displayWidth : undefined;
  // Keep the previous shared value, not the old development build's per-type overrides.
  if (width === "default" || width === "wide") sharedValues.displayWidth = width;
  const views: NewViewDefaults["views"] = {};
  for (const type of CREATION_DEFAULT_VIEW_TYPES) {
    const values = readValues(rawViews[type], getDefaultKeys(type).filter((key): key is ViewDefaultKey => key !== "quickFormEnabled"));
    if (Object.keys(values).length) views[type] = values;
  }
  // Migrate the former pair of toggles if preferences from a development build already exist.
  if (!("shared" in raw) && !("views" in raw)) {
    if (typeof raw.showEmptyFields === "boolean") sharedValues.showEmptyFields = raw.showEmptyFields;
    if (typeof raw.timelineContinuous === "boolean") views.timeline = { timelineContinuous: raw.timelineContinuous };
  }
  return { database, shared: sharedValues, views };
}

function getPreference(defaults: NewViewDefaults, group: CreationDefaultGroup, key: ViewDefaultKey): ViewConfig[ViewDefaultKey] {
  const common = isSharedDefault(key) ? defaults.shared[key] : undefined;
  return group === "shared" || group === "database" ? common : defaults.views[group]?.[key] ?? common;
}

export function getDisplayedDefault(defaults: NewViewDefaults, group: CreationDefaultGroup, key: CreationDefaultKey): ViewConfig[ViewDefaultKey] {
  if (key === "quickFormEnabled") return defaults.database.quickFormEnabled ?? false;
  return getPreference(defaults, group, key) ?? fields[key].base;
}

export function getEditorDefaultValue(view: ViewConfig, database: DatabaseConfig, key: CreationDefaultKey): unknown {
  if (key === "quickFormEnabled") return database.quickFormEnabled ?? false;
  return view[key] ?? fields[key].base;
}

export function hasViewDefaultOverride(defaults: NewViewDefaults, group: CreationDefaultGroup, key: SharedDefaultKey): boolean {
  return group !== "shared" && group !== "database" && defaults.views[group]?.[key] !== undefined;
}

export function updateCreationDefault(defaults: NewViewDefaults, group: CreationDefaultGroup, key: CreationDefaultKey, value: unknown): void {
  if (!getDefaultKeys(group).includes(key)) return;
  if (key === "quickFormEnabled") {
    if (typeof value === "boolean") defaults.database.quickFormEnabled = value;
    return;
  }
  const target = group === "shared" ? defaults.shared : group === "database" ? undefined : (defaults.views[group] ??= {});
  if (!target) return;
  if (fields[key].valid(value)) Object.assign(target, { [key]: value });
  else if (value === undefined) delete (target as ViewValues)[key];
}

export function applyNewViewDisplayWidth(view: ViewConfig, defaults: NewViewDefaults | undefined): void {
  const width = defaults?.shared.displayWidth;
  if (view.displayWidth === undefined && width !== undefined) view.displayWidth = width;
}

export function applyNewViewDefaults(view: ViewConfig, defaults: NewViewDefaults | undefined): void {
  const type = view.viewType ?? "table";
  if (!defaults) return;
  applyNewViewDisplayWidth(view, defaults);
  if (type === "form") return;
  for (const key of getDefaultKeys(type)) {
    if (key === "quickFormEnabled" || view[key] !== undefined) continue;
    const value = getPreference(defaults, type, key);
    if (value === undefined) continue;
    Object.assign(view, { [key]: value });
    // A creation default must not convert date-only properties to date & time.
    // Resolve the same fallback as the renderer before persisting the new view.
    if (key === "timelineScale" && value === "day") normalizeTimelineDayScale(view);
  }
}

export function applyNewDatabaseDefaults(database: DatabaseConfig, defaults: NewViewDefaults | undefined): void {
  if (database.quickFormEnabled === undefined && defaults?.database.quickFormEnabled !== undefined) {
    database.quickFormEnabled = defaults.database.quickFormEnabled;
  }
  for (const view of database.views) applyNewViewDefaults(view, defaults);
}
