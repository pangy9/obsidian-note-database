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
    expect(filterPanel).toContain("toPropertyDropdownOption");
    expect(filterPanel).toContain("renderDropdownPropertyTypeIcon");
    expect(filterPanel).toContain("db-filter-operator-dropdown");
    expect(filterPanel).toContain("db-filter-value-dropdown");
    // checkbox filter offers only "is checked / is unchecked" (notempty/empty) and migrates legacy eq/neq.
    expect(filterPanel).toContain('["notempty", t("filter.checkboxChecked")], ["empty", t("filter.checkboxUnchecked")]');
    expect(filterPanel).toContain('currentCol?.type === "checkbox" && (rule.op === "eq" || rule.op === "neq")');
    expect(sortPanel).toContain("createDropdownField");
    expect(sortPanel).not.toContain("row.createEl(\"select\")");
    expect(sortPanel).toContain("db-sort-field-dropdown");
    expect(sortPanel).toContain("toPropertyDropdownOption");
    expect(sortPanel).toContain("renderDropdownPropertyTypeIcon");
    expect(sortPanel).toContain("db-sort-direction-dropdown");
    expect(styles).toContain(".note-database-container .db-panel-row .db-panel-dropdown");
    expect(cssRule(styles, ".note-database-container .db-panel-row .db-filter-field-dropdown.has-current-icon,\n.note-database-container .db-panel-row .db-sort-field-dropdown.has-current-icon")).toContain("grid-template-columns: 16px minmax(0, 1fr) 14px");
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
    expect(viewConfig).toContain("getPropertyDropdownIcon(option.type)");
    expect(viewConfig).toContain("renderIcon: renderDropdownPropertyTypeIcon");
    // aliases is offered directly in the source-rule field dropdown (parallel to file.tags),
    // typed as multi-select so its operator picker offers list ops.
    expect(viewConfig).toContain('{ value: "aliases", label: "aliases", type: "multi-select" }');
    expect(viewConfig).toContain('if (isObsidianAliasesKey(field)) return "multi-select"');
    expect(viewConfig).toContain("db-status-preset-setting-dropdown");
    // View-level source rules (from .base conversion/embeds) must be visible+editable.
    expect(viewConfig).toContain("renderViewSourceRulesSection");
    expect(viewConfig).toContain('config.viewSourceRulesEnabled === true');
    expect(viewConfig).toContain('renderSourceRules(panel, config as unknown as DatabaseConfig');
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
    expect(cssRule(styles, ".note-database-settings .setting-group-body .setting-item")).toContain("grid-template-columns: minmax(0, 1fr) max-content");
    expect(cssRule(styles, ".note-database-settings .setting-group-body .setting-item .setting-item-info")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-settings .setting-group-body .setting-item .setting-item-control")).toContain("flex: 0 0 auto");
    expect(cssRule(styles, ".note-database-settings .setting-group-body .setting-item .setting-item-control")).toContain("min-width: max-content");
    expect(cssRule(styles, ".note-database-settings .setting-group-body .setting-item .setting-item-name,\n.note-database-settings .setting-group-body .setting-item .setting-item-description")).toContain("white-space: normal");
    expect(cssRule(styles, ".note-database-settings .db-settings-dropdown")).toContain("min-width: max-content");
    expect(cssRule(styles, ".db-dropdown-popover.db-dropdown-popover-context-settings,\n.db-dropdown-popover.db-dropdown-popover-context-modal")).toContain("background: var(--background-primary)");
    expect(cssRule(styles, ".db-dropdown-popover-context-settings .db-dropdown-option,\n.db-dropdown-popover-context-modal .db-dropdown-option")).toContain("grid-template-columns: 16px minmax(0, 1fr)");
    expect(cssRule(styles, ".is-phone .note-database-settings .setting-group-body .setting-item")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(cssRule(styles, ".is-phone .note-database-settings .setting-group-body .setting-item .setting-item-info,\n.is-phone .note-database-settings .setting-group-body .setting-item .setting-item-control")).toContain("min-width: 0");
    expect(styles).toContain(".is-phone .note-database-settings .setting-group-body .setting-item .setting-item-control {\n  flex: 1 1 auto;\n  flex-wrap: wrap;");
    expect(cssRule(styles, ".is-phone .note-database-settings .db-settings-dropdown")).toContain("width: 100%");
    expect(cssRule(styles, ".is-phone .note-database-settings .db-settings-dropdown")).toContain("min-width: 0");
    expect(cssRule(styles, ".is-phone .note-database-settings .db-settings-dropdown .db-dropdown-field-value")).toContain("overflow: hidden");
    expect(cssRule(styles, ".is-phone .note-database-settings .db-status-preset-setting-item .setting-item-control")).toContain("min-width: 0");
    expect(cssRule(styles, ".is-phone .note-database-modal .db-status-preset-default-row")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(cssRule(styles, ".is-phone .note-database-modal .db-status-preset-default-dropdown")).toContain("width: 100%");
    expect(cssRule(styles, ".is-phone .note-database-modal .db-status-preset-default-dropdown")).toContain("min-width: 0");
    expect(styles).toContain(".note-database-settings .db-dropdown-field");
  });

  it("keeps all card/event title field pickers searchable", () => {
    const viewConfig = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const calendarToolbar = readFileSync(new URL("../views/CalendarToolbarRenderer.ts", import.meta.url), "utf8");
    const timelineToolbar = readFileSync(new URL("../views/CalendarTimelineToolbarRenderer.ts", import.meta.url), "utf8");

    expect(viewConfig).toContain("private renderTitleField");
    expect(viewConfig).toContain("actions.onChange(t(\"undo.titleFieldConfig\"));\n      },\n      true");
    expect(calendarToolbar).toContain("actions.onChange(t(\"undo.calendarTitleFieldConfig\"));\n\t\t}, \"text-cursor-input\", true)");
    expect(timelineToolbar).toContain("actions.onChange(t(\"undo.timelineTitleFieldConfig\"));\n    }, \"text-cursor-input\", true)");
  });

  it("uses custom grouped popover for column type changes and icons for prominent type pickers", () => {
    const columnMenu = readFileSync(new URL("../views/ColumnMenu.ts", import.meta.url), "utf8");
    const viewConfig = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const chartToolbar = readFileSync(new URL("../views/ChartToolbarRenderer.ts", import.meta.url), "utf8");
    const summary = readFileSync(new URL("../views/SummaryRenderer.ts", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const dropdown = readFileSync(new URL("../views/DropdownField.ts", import.meta.url), "utf8");
    const numberRenderer = readFileSync(new URL("../views/NumberDisplayRenderer.ts", import.meta.url), "utf8");
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const tableSync = readFileSync(new URL("../views/TableColumnLayoutSync.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(columnMenu).toContain("showColumnTypePopover");
    expect(columnMenu).toContain("showNumberDisplayStylePopover");
    expect(columnMenu).toContain("openColumnWidthPanel?");
    expect(columnMenu).toContain("menu.adjustColumnWidth");
    expect(columnMenu).toContain("this.isPhoneLayout() && includeWidthActions");
    expect(columnMenu).toContain("createColumnMenuSubpopover");
    expect(columnMenu).toContain("db-column-menu-subpopover");
    expect(columnMenu).toContain("db-column-display-style-popover db-column-number-style-popover");
    expect(columnMenu).toContain("renderNumberStyleMenuIcon");
    expect(columnMenu).toContain("menu.numberDisplayIconStyle");
    expect(columnMenu).toContain("menu.numberDisplayIconEmoji");
    expect(columnMenu).toContain("menu.numberDisplayEmoji");
    expect(columnMenu).toContain("{ value: \"emoji\"");
    expect(columnMenu).toContain("menu.numberDisplayColorTheme");
    expect(columnMenu).toContain("menu.numberDisplayColorCustom");
    expect(columnMenu).toContain("if (currentRatingSymbol !== \"emoji\")");
    expect(columnMenu).toContain("db-number-style-menu-progress");
    expect(columnMenu).toContain("db-number-style-menu-ring-arc");
    expect(columnMenu).not.toContain("icon: \"target\"");
    expect(columnMenu).toContain("pointerleave");
    expect(columnMenu).toContain("scheduleHoverClose");
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
    expect(toolbar).toContain("db-view-tab-popover-chevron");
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
    expect(dropdown).toContain("getDropdownPopoverContextClass");
    expect(dropdown).toContain("anchor.ownerDocument.body");
    expect(dropdown).toContain("db-dropdown-popover-context-settings");
    expect(dropdown).toContain("db-dropdown-popover-context-modal");
    expect(dropdown).toContain(".note-database-container");
    expect(dropdown).not.toContain(".db-chart-subpopover, .db-chart-options-popover");
    expect(dropdown).toContain("option.icon ? \" has-icon\" : \"\"");
    expect(dropdown).toContain("if (options.renderIcon) options.renderIcon(iconEl, option.icon)");
    expect(dropdown).toContain("else setIcon(iconEl, option.icon)");
    expect(dropdown).toContain("getOptionIcon(options.options, value)");
    expect(dropdown).toContain("renderButtonIcon(currentValue)");
    expect(dropdown).toContain("button.toggleClass(\"has-current-icon\", Boolean(icon))");
    expect(dropdown).toContain("db-dropdown-option-icon");
    expect(numberRenderer).toContain("symbol === \"emoji\"");
    expect(numberRenderer).toContain("db-rating-emoji");
    expect(numberRenderer).toContain("if (!isEmoji) applyColorClass");
    expect(databaseView).toContain("showMobileColumnWidthPanel");
    expect(databaseView).toContain("MOBILE_COLUMN_WIDTH_MIN = 60");
    expect(databaseView).toContain("MOBILE_COLUMN_WIDTH_MAX = 360");
    expect(databaseView).toContain("config.columnWidths = { ...(config.columnWidths || {}), [col.key]: nextWidth }");
    expect(databaseView).toContain("this.calculateAutoColumnWidth(col, this.rows)");
    expect(databaseView).toContain("this.pendingUndoLabel = t(\"undo.columnWidthConfig\")");
    expect(databaseView).toContain("syncTableColumnLayouts(root, config)");
    expect(tableSync).toContain("export function syncTableColumnLayouts");
    expect(tableSync).toContain("tableWrap.style.minWidth");
    expect(viewConfig).toContain("controls.insertBefore(operatorDropdown.button, value)");
    expect(styles).toContain(".db-column-menu-subpopover");
    expect(styles).toContain(".db-column-menu-subpopover .db-number-style-menu-progress");
    expect(styles).toContain(".db-column-menu-subpopover .db-number-style-menu-ring-arc");
    expect(cssRule(styles, ".db-column-display-style-popover.db-column-menu-subpopover")).toContain("width: 292px");
    expect(cssRule(styles, ".db-displayopt-dropdown-popover")).toContain("background: var(--background-primary)");
    expect(cssRule(styles, ".db-column-display-style-popover .db-toggle-switch")).toContain("appearance: none");
    expect(cssRule(styles, ".db-column-display-style-popover .db-displayopt-swatch")).toContain("border-radius: 2px");
    expect(cssRule(styles, ".db-column-display-style-popover .db-displayopt-swatch.is-selected")).toContain("0 0 0 3px #000");
    expect(cssRule(styles, ".db-column-display-style-popover .db-displayopt-swatches")).toContain("justify-content: flex-start");
    expect(cssRule(styles, ".menu-item .db-menu-item-current")).toContain("color: var(--text-faint)");
    expect(cssRule(styles, ".menu-item .db-menu-item-current")).toContain("font-size: 12px");
    expect(styles).toContain(".db-column-display-style-popover .db-displayopt-swatch.db-option-color-green");
    expect(styles).toContain(".db-mobile-column-width-panel");
    expect(styles).toContain(".db-mobile-column-width-backdrop");
    expect(styles).toContain(".db-mobile-column-width-slider");
    expect(columnMenu).toContain("progressDivisor: 1000");
    expect(styles).toContain(".note-database-container .db-cell-rating.is-outline");
    expect(styles).toContain(".note-database-container .db-cell-rating.is-emoji");
    expect(styles).toContain(".db-column-type-popover .db-column-type-option-icon");
    expect(styles).toContain(".note-database-container .db-dropdown-option.has-icon");
    expect(styles).toContain(".note-database-container .db-dropdown-option-icon");
    expect(cssRule(styles, ".note-database-container .db-view-tab-popover-row")).toContain("grid-template-columns: 22px minmax(0, 1fr) 16px");
    expect(cssRule(styles, ".note-database-container .db-view-tab-popover-marker,\n.note-database-container .db-view-tab-popover-chevron")).toContain("flex: 0 0 auto");
    expect(cssRule(styles, ".note-database-container .db-view-tab-popover-label")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-container .db-dropdown-popover")).toContain("max-height: min(360px, calc(100vh - 24px))");
    expect(cssRule(styles, ".note-database-container .db-dropdown-popover")).toContain("overflow-y: auto");
    expect(cssRule(styles, ".note-database-container .db-dropdown-popover")).toContain("overscroll-behavior: contain");
    expect(cssRule(styles, ".note-database-container .db-dropdown-field")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-container .db-dropdown-option")).toContain("width: 100%");
    expect(cssRule(styles, ".note-database-container .db-dropdown-option")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-container .db-dropdown-option-check,\n.note-database-container .db-dropdown-option-icon,\n.note-database-container .db-dropdown-option-swatches")).toContain("flex: 0 0 auto");
    expect(cssRule(styles, ".note-database-container .db-dropdown-field.has-current-icon .db-dropdown-field-icon,\n.note-database-container .db-dropdown-field-chevron")).toContain("flex: 0 0 auto");
    expect(styles).toContain(".note-database-container .db-dropdown-search");
    expect(cssRule(styles, ".note-database-modal .db-dropdown-popover")).toContain("overflow-y: auto");
    expect(cssRule(styles, ".note-database-settings .db-dropdown-popover")).toContain("overflow-y: auto");
    expect(cssRule(styles, ".note-database-modal .db-dropdown-field")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-settings .db-dropdown-field")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-modal .db-dropdown-option")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-settings .db-dropdown-option")).toContain("min-width: 0");
    expect(cssRule(styles, ".db-column-menu-subpopover .db-dropdown-option")).toContain("min-width: 0");
    expect(dropdown).not.toContain("db-dropdown-section-separator");
    expect(styles).not.toContain("db-dropdown-section-separator");
    expect(cssRule(styles, ".note-database-container .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
    expect(cssRule(styles, ".note-database-modal .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
    expect(cssRule(styles, ".note-database-settings .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
    expect(cssRule(styles, ".db-column-menu-subpopover .db-dropdown-option + .db-dropdown-section-title")).toContain("margin-top: 8px");
  });

  it("keeps property name lists icon-first without visible type text", () => {
    const columnManager = readFileSync(new URL("../views/ColumnManagerRenderer.ts", import.meta.url), "utf8");
    const viewConfig = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const calendar = readFileSync(new URL("../views/CalendarToolbarRenderer.ts", import.meta.url), "utf8");
    const timeline = readFileSync(new URL("../views/CalendarTimelineToolbarRenderer.ts", import.meta.url), "utf8");
    const summary = readFileSync(new URL("../views/SummaryRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(columnManager).toContain("renderPropertyTypeIcon(typeEl, col, \"db-column-type-icon\")");
    expect(columnManager).not.toContain("typeEl.createSpan({ text: COLUMN_TYPE_LABELS()[col.type] })");
    expect(columnManager).not.toContain("db-column-number-style-toggle");
    expect(viewConfig).toContain("this.toFieldDropdownOption(config, col)");
    expect(viewConfig).toContain("db-view-config-field-dropdown");
    expect(viewConfig).toContain("const hasPropertyIcons = options.some((option) => isPropertyDropdownIcon(option.icon))");
    expect(viewConfig).not.toContain("const hasOptionIcons = options.some((option) => Boolean(option.icon))");
    expect(calendar).toContain("getPropertyDropdownIcon(getColumnDisplayType(col, config.schema.computedFields))");
    expect(timeline).toContain("getPropertyDropdownIcon(getColumnDisplayType(col, config.schema.computedFields))");
    expect(summary).toContain("renderIcon: renderDropdownPropertyTypeIcon");
    expect(cssRule(styles, ".note-database-container .db-column-manager-row")).toContain("grid-template-columns: 18px 20px 18px minmax(120px, 1fr)");
    expect(cssRule(styles, ".note-database-container .db-source-rule-dropdown.db-source-rule-field.has-current-icon")).toContain("grid-template-columns: 16px minmax(0, 1fr) 18px");
    expect(cssRule(styles, ".note-database-container .db-view-config-field-dropdown.has-current-icon")).toContain("grid-template-columns: 16px minmax(0, 1fr) 16px");
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
      for (const key of ["panel.field", "panel.operator", "panel.sortDirection", "viewConfig.sourceRules.logic", "viewConfig.sourceRules.fieldGroup.custom", "columnType.group.basic", "columnType.group.options", "columnType.group.advanced", "menu.adjustColumnWidth", "columnWidth.adjustTitle", "columnWidth.auto", "columnWidth.narrow", "columnWidth.medium", "columnWidth.wide"] as const) {
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
