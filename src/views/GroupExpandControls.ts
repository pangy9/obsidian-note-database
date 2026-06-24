import { t } from "../i18n";
import { getGroupRowLimit, getGroupVisibleCount } from "../data/GroupVisibility";
import { ViewConfig } from "../data/types";

export interface GroupExpandActions {
  expandGroup?(field: string, key: string, count: number): void;
}

/** Render the "+N / 完全展开 / 收起" controls at a group's bottom when row limiting applies.
 *  count semantics for expandGroup: -1 = fully expanded, positive M = show M, 0 = reset to limit.
 *  Returns true if any control was rendered. */
export function renderGroupExpandControls(
  parent: HTMLElement,
  config: ViewConfig,
  field: string,
  key: string,
  totalCount: number,
  actions: GroupExpandActions
): boolean {
  const limit = getGroupRowLimit(config);
  if (limit <= 0 || totalCount <= limit) return false;
  const visible = getGroupVisibleCount(config, field, key, totalCount);
  const hidden = totalCount - visible;
  const expandedBeyondLimit = visible > limit;
  if (hidden <= 0 && !expandedBeyondLimit) return false;

  const row = parent.createDiv({ cls: "db-group-expand-controls" });
  if (hidden > 0) {
    const more = row.createEl("button", {
      cls: "db-group-expand-btn db-group-expand-more",
      text: t("group.expandMore", { count: Math.min(limit, hidden) }),
    });
    more.onclick = () => actions.expandGroup?.(field, key, visible + limit);
    const all = row.createEl("button", {
      cls: "db-group-expand-btn db-group-expand-all",
      text: t("group.expandAll"),
    });
    all.onclick = () => actions.expandGroup?.(field, key, -1);
  }
  if (expandedBeyondLimit) {
    const collapse = row.createEl("button", {
      cls: "db-group-expand-btn db-group-collapse",
      text: t("group.collapseToLimit"),
    });
    collapse.onclick = () => actions.expandGroup?.(field, key, 0);
  }
  return true;
}
