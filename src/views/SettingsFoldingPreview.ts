import { setIcon, type App } from "obsidian";
import type { SettingFoldGroupId, SettingsFoldingPreferences } from "../data/SettingsFolding";
import type { DatabaseConfig, DatabaseViewType, RecordSchema, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { CalendarTimelineToolbarRenderer } from "./CalendarTimelineToolbarRenderer";
import { CalendarToolbarRenderer } from "./CalendarToolbarRenderer";
import { ChartToolbarRenderer } from "./ChartToolbarRenderer";
import { positionToolbarPopover } from "./PopoverPosition";
import { ViewConfigPanelRenderer } from "./ViewConfigPanelRenderer";

const sampleViewTypes: Record<SettingFoldGroupId, DatabaseViewType> = {
  database: "table", view: "gallery", gallery: "gallery", board: "board", list: "list",
  calendar: "calendar", timeline: "timeline", chart: "chart", form: "form",
};

export function createSettingsSample(viewType: DatabaseViewType): { database: DatabaseConfig; view: ViewConfig } {
  // Isolated configuration: no vault files or actual database state.
  const schema: RecordSchema = {
    columns: [
      { key: "file.name", type: "text", label: t("defaults.nameColumn") },
      { key: "start", type: "datetime", label: t("viewConfig.eventStartDateField") },
      { key: "end", type: "datetime", label: t("viewConfig.eventEndDateField") },
      { key: "status", type: "status", label: t("columnType.status"), statusOptions: [
        { value: t("settings.folding.sampleTodo"), color: "gray" },
        { value: t("settings.folding.sampleDone"), color: "green" },
      ] },
    ],
    computedFields: [],
  };
  const name = t("settings.folding.sampleName");
  const view: ViewConfig = {
    id: "folding-preview-view", name, sourceFolder: name, schema, viewType,
    calendarScale: "week", calendarStartDateField: "start", calendarEndDateField: "end",
    timelineStartDateField: "start", timelineEndDateField: "end",
    boardGroupField: "status", chartGroupField: "status", showRecordIcon: true,
  };
  const database: DatabaseConfig = {
    id: "folding-preview-db", name, sourceFolder: name, schema, views: [view],
  };
  return { database, view };
}

export function renderSettingsPopoverPreview(
  host: HTMLElement, app: App, group: SettingFoldGroupId, draft: SettingsFoldingPreferences,
): HTMLElement {
  // No vault files, existing database state or write callbacks are passed into the renderer.
  const settingsFolding = { ...draft, enabled: true };
  const { database, view } = createSettingsSample(sampleViewTypes[group]);
  const actions = { database, getSettingsFolding: () => settingsFolding, onChange: () => {} };
  if (group === "calendar") return new CalendarToolbarRenderer().renderPreview(host, view, actions);
  if (group === "timeline") return new CalendarTimelineToolbarRenderer().renderPreview(host, view, actions);
  if (group === "chart") return new ChartToolbarRenderer().renderPreview(host, view, actions);
  return new ViewConfigPanelRenderer().render(host, true, view, { ...actions, app, settingsFolding })!;
}

export function openSettingsFoldingPreview(options: {
  app: App;
  container: HTMLElement;
  anchor: HTMLButtonElement;
  group: SettingFoldGroupId;
  draft: SettingsFoldingPreferences;
  id: string;
  onClose: () => void;
}): () => void {
  const { app, container, anchor, group, draft, id, onClose } = options;
  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  const host = container.createDiv({ cls: "note-database-container db-settings-folding-preview-host" });
  const panel = renderSettingsPopoverPreview(host, app, group, draft);
  panel.id = id;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("settings.folding.openPreview"));

  // Keep real field styles without allowing sample controls to activate, including by keyboard.
  // Native More disclosures and the preview close button remain interactive.
  for (const control of panel.querySelectorAll<HTMLElement>("button, input, textarea, select, label, a, [role=button], [contenteditable], [tabindex]")) {
    control.inert = true;
  }
  const header = panel.querySelector<HTMLElement>(".db-panel-header")!;
  const tools = header.createDiv({ cls: "db-panel-header-actions" });
  tools.createSpan({ cls: "db-settings-folding-preview-hint", text: t("settings.folding.previewReadOnly") });
  const closeButton = tools.createEl("button", { cls: "db-icon-only-button", attr: {
    type: "button", "aria-label": t("common.close"),
  } });
  setIcon(closeButton, "x");

  const position = () => positionToolbarPopover(panel, anchor, {
    placement: "submenu",
    preferredWidth: group === "calendar" || group === "timeline" ? 420 : 520,
  });
  let closed = false;
  const close = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", outside, true);
    win.removeEventListener("keydown", escape, true);
    win.removeEventListener("resize", position);
    container.removeEventListener("scroll", repositionOnScroll, true);
    host.remove();
    anchor.setAttribute("aria-expanded", "false");
    onClose();
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  const outside = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target && !panel.contains(target) && !anchor.contains(target)) close();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close(true);
  };
  const repositionOnScroll = (event: Event) => {
    if (event.target !== panel && event.target instanceof win.Node && !host.contains(event.target)) position();
  };

  closeButton.onclick = () => close(true);
  anchor.setAttribute("aria-expanded", "true");
  doc.addEventListener("pointerdown", outside, true);
  win.addEventListener("keydown", escape, true);
  win.addEventListener("resize", position);
  container.addEventListener("scroll", repositionOnScroll, true);
  panel.addEventListener("toggle", position, true);
  position();
  closeButton.focus({ preventScroll: true });
  if (group !== "database") {
    const viewSection = panel.querySelector<HTMLElement>("[data-settings-view-section]");
    if (viewSection) panel.scrollTop = viewSection.offsetTop - header.offsetHeight - 12;
  }
  return close;
}
