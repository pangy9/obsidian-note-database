import {
  isObsidianTagsKey,
  isOptionColumnType,
  normalizeOptionValueForKey,
  toMultiSelectValuesForKey,
} from "./ColumnTypes";
import { ColumnDef, StatusColor, StatusOptionDef } from "./types";

export const OPTION_REGISTRATION_COLORS: StatusColor[] = [
  "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink",
  "red", "slate", "cyan", "teal", "lime", "indigo", "violet", "rose",
];

export interface OptionRegistrationPlan {
  participates: boolean;
  value: unknown;
  options: StatusOptionDef[];
  addedOptions: StatusOptionDef[];
  clearPresetId: boolean;
}

export function planOptionRegistration(col: ColumnDef, candidate: unknown): OptionRegistrationPlan {
  const options = (col.statusOptions || []).map((option) => ({ ...option }));
  if (!isOptionColumnType(col.type) || isObsidianTagsKey(col.key) || col.key === "file.tags") {
    return { participates: false, value: candidate, options, addedOptions: [], clearPresetId: false };
  }

  const values = col.type === "multi-select"
    ? toMultiSelectValuesForKey(col.key, candidate)
    : [normalizeOptionValueForKey(col.key, candidate)].filter(Boolean);
  const normalized: string[] = [];
  const seenValues = new Set<string>();
  for (const value of values) {
    if (!value || seenValues.has(value)) continue;
    seenValues.add(value);
    normalized.push(value);
  }

  const known = new Set(options.map((option) => option.value));
  const addedOptions: StatusOptionDef[] = [];
  for (const value of normalized) {
    if (known.has(value)) continue;
    const option: StatusOptionDef = {
      value,
      color: OPTION_REGISTRATION_COLORS[options.length % OPTION_REGISTRATION_COLORS.length],
    };
    options.push(option);
    addedOptions.push(option);
    known.add(value);
  }

  return {
    participates: true,
    value: col.type === "multi-select" ? normalized : (normalized[0] || ""),
    options,
    addedOptions,
    clearPresetId: col.type === "status" && addedOptions.length > 0,
  };
}
