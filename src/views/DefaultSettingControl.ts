import type { CreationDefaultKey } from "../data/NewViewDefaults";

type DefaultControlCallback<T> = ((value: T) => void) & { settingDefault?: CreationDefaultKey };

// Opt in at the original setting's setter, instead of matching localized labels or recreating controls.
export function defaultSetting<T>(key: CreationDefaultKey, change: (value: T) => void): DefaultControlCallback<T> {
  return Object.assign(change, { settingDefault: key });
}

export function markDefaultSetting<T>(element: HTMLElement, change: DefaultControlCallback<T>): void {
  if (change.settingDefault) element.dataset.creationDefault = change.settingDefault;
}
