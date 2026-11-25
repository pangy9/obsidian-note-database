import { setIcon } from "obsidian";
import type { SettingFoldId } from "../data/SettingsFolding";
import { t } from "../i18n";

export type FoldSection = "database" | "view" | "calendar" | "timeline" | "chart";
const TITLES: Record<FoldSection, string> = {
  database: "viewConfig.moreDatabaseSettings",
  view: "viewConfig.moreViewSettings",
  calendar: "viewConfig.moreDisplayOptions",
  timeline: "viewConfig.moreDisplayOptions",
  chart: "viewConfig.moreViewSettings",
};

export function readSettingsFoldOpen(parent: Element | null, scope: FoldSection): boolean {
  return parent?.querySelector<HTMLDetailsElement>(`details[data-settings-fold="${scope}"]`)?.open === true;
}

/** Keep whole dependent blocks together and never render an empty disclosure. */
export function createSettingsFoldSection(parent: HTMLElement, selected: ReadonlySet<SettingFoldId>, scope: FoldSection, open = false, onToggle?: () => void) {
  let details: HTMLDetailsElement | undefined;
  let content: HTMLElement | undefined;
  return {
    target(id: SettingFoldId, regular = parent): HTMLElement {
      if (!selected.has(id)) return regular;
      if (!content) {
        details = parent.createEl("details", { cls: "db-more-display-options", attr: { "data-settings-fold": scope } });
        details.open = open;
        details.ontoggle = () => { if (details?.isConnected) onToggle?.(); };
        const summary = details.createEl("summary");
        setIcon(summary.createSpan({ cls: "db-more-display-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
        summary.createSpan({ text: t(TITLES[scope]) });
        content = details.createDiv({ cls: "db-more-display-content" });
      }
      return content;
    },
    finish(): void {
      if (!details || !content) return;
      if (content.childElementCount) parent.appendChild(details);
      else details.remove();
    },
  };
}
export type SettingsFoldSection = ReturnType<typeof createSettingsFoldSection>;
