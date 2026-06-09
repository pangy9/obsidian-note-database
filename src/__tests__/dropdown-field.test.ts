import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
// eslint-disable-next-line import/no-nodejs-modules
import { readdirSync, statSync } from "node:fs";
// eslint-disable-next-line import/no-nodejs-modules
import { join } from "node:path";
import { setLocale, t } from "../i18n";

describe("shared dropdown field adoption", () => {
  it("uses shared dropdown popovers in filter and sort panels", () => {
    const filterPanel = readFileSync(new URL("../views/FilterPanelRenderer.ts", import.meta.url), "utf8");
    const sortPanel = readFileSync(new URL("../views/SortPanelRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(filterPanel).toContain("createDropdownField");
    expect(filterPanel).not.toContain("row.createEl(\"select\")");
    expect(filterPanel).toContain("db-filter-field-dropdown");
    expect(filterPanel).toContain("db-filter-operator-dropdown");
    expect(filterPanel).toContain("db-filter-value-dropdown");
    expect(sortPanel).toContain("createDropdownField");
    expect(sortPanel).not.toContain("row.createEl(\"select\")");
    expect(sortPanel).toContain("db-sort-field-dropdown");
    expect(sortPanel).toContain("db-sort-direction-dropdown");
    expect(styles).toContain(".note-database-container .db-panel-row .db-panel-dropdown");
  });

  it("uses shared dropdown popovers in low-risk modals", () => {
    const baseImport = readFileSync(new URL("../views/modals/BaseImportConfirmModal.ts", import.meta.url), "utf8");
    const statusPresets = readFileSync(new URL("../views/modals/StatusPresetManagerModal.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(baseImport).toContain("createDropdownField");
    expect(baseImport).not.toContain("typeTd.createEl(\"select\")");
    expect(baseImport).toContain("db-base-import-type-dropdown");
    expect(statusPresets).toContain("createDropdownField");
    expect(statusPresets).not.toContain("row.createEl(\"select\"");
    expect(statusPresets).toContain("db-status-preset-default-dropdown");
    expect(styles).toContain(".note-database-modal .db-dropdown-field");
    expect(styles).toContain(".note-database-modal .db-dropdown-popover");
  });

  it("uses shared dropdown popovers in source rules, formula modal, and settings", () => {
    const viewConfig = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const formula = readFileSync(new URL("../views/modals/FormulaModal.ts", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../settings.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(viewConfig).toContain("db-source-rule-dropdown");
    expect(viewConfig).toContain("getSourceRuleFieldOptions");
    expect(viewConfig).toContain("db-status-preset-setting-dropdown");
    expect(formula).toContain("db-formula-result-type-dropdown");
    expect(formula).toContain("db-formula-preview-dropdown");
    expect(formula).toContain("selectedResultType");
    expect(formula).toContain("selectedPreviewIndex");
    expect(settings).toContain("renderSettingsDropdown");
    expect(settings).toContain("db-settings-dropdown");
    expect(settings).toContain("db-status-preset-setting-item");
    expect(styles).toContain(".note-database-container .db-source-rule-dropdown");
    expect(styles).toContain(".note-database-container .db-source-rule-icon-button");
    expect(styles).toContain("border: 0");
    expect(styles).toContain(".note-database-container .db-view-config-inline-controls .db-view-config-dropdown");
    expect(styles).toContain(".note-database-container .db-status-preset-setting-dropdown");
    expect(styles).toContain(".note-database-settings .db-status-preset-setting-item .setting-item-control");
    expect(styles).toContain(".note-database-settings .db-dropdown-field");
  });

  it("uses custom grouped popover for column type changes and icons for prominent type pickers", () => {
    const columnMenu = readFileSync(new URL("../views/ColumnMenu.ts", import.meta.url), "utf8");
    const viewConfig = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const chartToolbar = readFileSync(new URL("../views/ChartToolbarRenderer.ts", import.meta.url), "utf8");
    const summary = readFileSync(new URL("../views/SummaryRenderer.ts", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const dropdown = readFileSync(new URL("../views/DropdownField.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(columnMenu).toContain("showColumnTypePopover");
    expect(columnMenu).toContain("db-column-type-popover");
    expect(columnMenu).not.toContain("setSubmenu");
    expect(columnMenu).toContain("columnType.group.basic");
    expect(columnMenu).not.toContain("db-dropdown-section-separator");
    expect(columnMenu).toContain("renderPropertyTypeIcon");
    expect(columnMenu).toContain("db-column-type-option-icon");
    expect(viewConfig).toContain("{ value: \"table\", text: t(\"common.tableView\"), icon: \"table\" }");
    expect(viewConfig).toContain("{ value: \"board\", text: t(\"common.boardView\"), icon: \"layout-grid\" }");
    expect(viewConfig).not.toContain("icon: \"kanban\"");
    expect(toolbar).toContain("if (viewType === \"board\") return \"layout-grid\"");
    expect(chartToolbar).toContain("{ value: \"bar\", text: t(\"chart.barChart\"), icon: \"bar-chart\" }");
    expect(chartToolbar).toContain("{ value: \"horizontal-bar\", text: t(\"chart.horizontalBarChart\"), icon: \"bar-chart-horizontal\" }");
    expect(chartToolbar).toContain("{ value: \"donut\", text: t(\"chart.donutChart\"), icon: \"pie-chart\" }");
    expect(chartToolbar).not.toContain("icon: \"chart-donut\"");
    expect(summary).toContain("openDropdownMenu");
    expect(summary).toContain("db-summary-dropdown-popover");
    expect(summary).not.toContain("icon: \"sigma\"");
    expect(toolbar).toContain("openDropdownMenu");
    expect(toolbar).toContain("db-view-tabs-dropdown-popover");
    expect(dropdown).toContain("icon?: string");
    expect(dropdown).toContain("searchable?: boolean");
    expect(dropdown).toContain("closeOnSelect?: boolean");
    expect(dropdown).toContain("export function openDropdownMenu");
    expect(dropdown).toContain("syncDropdownSelection");
    expect(dropdown).toContain("syncDropdownSelection(sectionRows, option.value)");
    expect(dropdown).toContain("if (options.closeOnSelect !== false) close()");
    expect(dropdown).toContain("db-dropdown-search");
    expect(dropdown).toContain("data-search-text");
    expect(dropdown).toContain("getDropdownPopoverHost");
    expect(dropdown).toContain(".note-database-container");
    expect(dropdown).not.toContain(".db-chart-subpopover, .db-chart-options-popover");
    expect(dropdown).toContain("option.icon ? \" has-icon\" : \"\"");
    expect(dropdown).toContain("if (options.renderIcon) options.renderIcon(iconEl, option.icon)");
    expect(dropdown).toContain("else setIcon(iconEl, option.icon)");
    expect(dropdown).toContain("db-dropdown-option-icon");
    expect(viewConfig).toContain("controls.insertBefore(operatorDropdown.button, value)");
    expect(styles).toContain(".db-column-type-popover .db-column-type-option-icon");
    expect(styles).toContain(".note-database-container .db-dropdown-option.has-icon");
    expect(styles).toContain(".note-database-container .db-dropdown-option-icon");
    expect(cssRule(styles, ".note-database-container .db-dropdown-popover")).toContain("max-height: min(360px, calc(100vh - 24px))");
    expect(cssRule(styles, ".note-database-container .db-dropdown-popover")).toContain("overflow-y: auto");
    expect(cssRule(styles, ".note-database-container .db-dropdown-popover")).toContain("overscroll-behavior: contain");
    expect(styles).toContain(".note-database-container .db-dropdown-search");
    expect(cssRule(styles, ".note-database-modal .db-dropdown-popover")).toContain("overflow-y: auto");
    expect(cssRule(styles, ".note-database-settings .db-dropdown-popover")).toContain("overflow-y: auto");
    expect(dropdown).not.toContain("db-dropdown-section-separator");
    expect(styles).not.toContain("db-dropdown-section-separator");
    expect(cssRule(styles, ".note-database-container .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
    expect(cssRule(styles, ".note-database-modal .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
    expect(cssRule(styles, ".note-database-settings .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
    expect(cssRule(styles, ".db-column-type-popover .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
  });

  it("keeps parent header popovers open while interacting with shared dropdown popovers", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(dashboard).toContain(".db-dropdown-popover");
    expect(embedded).toContain(".db-dropdown-popover");
  });

  it("does not create native dropdown controls in plugin views or settings", () => {
    const sourceRoots = [
      new URL("../views", import.meta.url),
      new URL("../settings.ts", import.meta.url),
    ];
    const sources = sourceRoots.flatMap((url) => readSources(url));
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/createEl\("select"/);
      expect(text, path).not.toContain("addDropdown(");
      expect(text, path).not.toContain("HTMLSelectElement");
      expect(text, path).not.toContain("setSubmenu");
    }
  });

  it("defines semantic dropdown labels for supported locales", () => {
    for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
      setLocale(locale);
      for (const key of ["panel.field", "panel.operator", "panel.sortDirection", "viewConfig.sourceRules.logic", "viewConfig.sourceRules.fieldGroup.custom", "columnType.group.basic", "columnType.group.options", "columnType.group.advanced"] as const) {
        expect(t(key), `${locale}:${key}`).not.toBe(key);
      }
    }
    setLocale("system");
  });
});

function readSources(url: URL): Array<{ path: string; text: string }> {
  const path = url.pathname;
  if (statSync(path).isFile()) return [{ path, text: readFileSync(path, "utf8") }];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return readSources(new URL(`file://${child}`));
    return child.endsWith(".ts") ? [{ path: child, text: readFileSync(child, "utf8") }] : [];
  });
}

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}
