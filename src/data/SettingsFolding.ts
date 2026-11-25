import { isRecord } from "./SafeString";

export const SETTING_FOLD_GROUPS = [
  { id: "database", label: "settings.folding.databaseTab", icon: "database", items: [
    { id: "databaseCover", label: "databaseCover.label" },
    { id: "newRecordFolder", label: "viewConfig.newRecordFolder" },
    { id: "newRecordTemplate", label: "template.label", recommended: true },
    { id: "quickForm", label: "form.quickFormEnabled.name", recommended: true },
    { id: "databaseRecordIcon", label: "recordIcon.field", recommended: true },
    { id: "computedSync", label: "viewConfig.computedSyncMode", recommended: true },
    { id: "databaseStatusPresets", label: "viewConfig.statusPreset", recommended: true },
  ] },
  { id: "view", label: "settings.folding.sharedTab", icon: "sliders-horizontal", items: [
    { id: "viewSourceRules", label: "viewConfig.viewSourceRules" },
    { id: "recordIcon", label: "recordIcon.show", recommended: true },
    { id: "conditionalFormatting", label: "conditionalFormat.title", recommended: true },
    { id: "viewStatusPresets", label: "viewConfig.statusPreset", recommended: true },
    { id: "defaultColumnWidth", label: "viewConfig.defaultColumnWidth", recommended: true },
    { id: "yearDisplay", label: "viewConfig.yearDisplayMode", recommended: true },
    { id: "titleField", label: "viewConfig.titleField" },
    { id: "showEmptyFields", label: "viewConfig.showEmptyFields", recommended: true },
  ] },
  { id: "board", label: "common.boardView", icon: "layout-grid", items: [
    { id: "boardSubgroup", label: "viewConfig.boardSubgroupField" },
    { id: "boardColumnWidth", label: "viewConfig.boardColumnWidth" },
    { id: "boardCoverSizing", label: "settings.folding.coverSizing", recommended: true },
  ] },
  { id: "gallery", label: "common.galleryView", icon: "image", items: [
    { id: "galleryCardSize", label: "viewConfig.cardSize" },
    { id: "galleryCoverSizing", label: "settings.folding.coverSizing", recommended: true },
  ] },
  { id: "list", label: "common.listView", icon: "list", items: [
    { id: "listCompactFields", label: "viewConfig.listCompactFields", recommended: true },
  ] },
  { id: "calendar", label: "common.calendarView", icon: "calendar-days", items: [
    { id: "calendarLayout", label: "calendar.layout", recommended: true },
    { id: "calendarTime", label: "calendar.time", recommended: true },
    { id: "calendarEventColor", label: "viewConfig.eventColorField" },
  ] },
  { id: "timeline", label: "common.timelineView", icon: "chart-gantt", items: [
    { id: "timelineLayout", label: "timeline.layoutSection", recommended: true },
    { id: "timelineContinuous", label: "timeline.continuous" },
    { id: "timelineEventColor", label: "viewConfig.eventColorField" },
  ] },
  { id: "chart", label: "common.chartView", icon: "bar-chart", items: [
    { id: "chartVisibleGroups", label: "chart.visibleGroups", recommended: true },
    { id: "chartStyleDetails", label: "chart.optionsStyleEntry" },
    { id: "chartExport", label: "chart.optionsExport", recommended: true },
  ] },
  { id: "form", label: "common.formView", icon: "clipboard-list", items: [
    { id: "formCover", label: "form.coverLabel", recommended: true },
  ] },
] as const;

type Group = typeof SETTING_FOLD_GROUPS[number];
export type SettingFoldGroupId = Group["id"];
export type SettingFoldId = Group["items"][number]["id"];
export interface SettingsFoldingPreferences {
  enabled: boolean;
  items: Record<SettingFoldGroupId, SettingFoldId[]>;
}

export function normalizeSettingsFolding(value: unknown): SettingsFoldingPreferences {
  const raw = isRecord(value) ? value : {};
  const rawItems = isRecord(raw.items) ? raw.items : {};
  const items = {} as SettingsFoldingPreferences["items"];
  for (const group of SETTING_FOLD_GROUPS) {
    const stored = rawItems[group.id];
    // An explicit empty selection is distinct from an unset or malformed group.
    items[group.id] = group.items
      .filter(item => Array.isArray(stored) ? stored.includes(item.id) : "recommended" in item && item.recommended)
      .map(item => item.id);
  }
  return { enabled: raw.enabled === true, items };
}

export function selectedSettingFolds(preferences: SettingsFoldingPreferences | undefined): ReadonlySet<SettingFoldId> {
  return new Set(preferences?.enabled ? Object.values(preferences.items).flat() : []);
}

export type SettingsFoldingChange = Pick<SettingsFoldingPreferences, "enabled"> | Pick<SettingsFoldingPreferences, "items">;

/** Commit just this presentation preference, leaving the live settings untouched if the write fails. */
export async function persistSettingsFolding<T extends { settingsFolding?: SettingsFoldingPreferences }>(
  settings: T,
  change: SettingsFoldingChange,
  save: (next: T) => Promise<void>,
): Promise<boolean> {
  const before = normalizeSettingsFolding(settings.settingsFolding);
  const next = normalizeSettingsFolding({ ...before, ...change });
  if (JSON.stringify(before) === JSON.stringify(next)) return false;
  await save({ ...settings, settingsFolding: next });
  settings.settingsFolding = next;
  return true;
}
