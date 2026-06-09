import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { setLocale, t } from "../i18n";

const chartKeys = [
  "common.close",
  "common.chartView",
  "chart.other",
  "chart.countLabel",
  "chart.noFields",
  "chart.noFieldSelected",
  "chart.noValueFieldSelected",
  "chart.noRecords",
  "chart.allGroupsHidden",
  "chart.showAllGroups",
  "chart.invalidAxisRange",
  "chart.resetAxisRange",
  "chart.chooseDefaultGroup",
  "chart.chooseDefaultValue",
  "chart.barChart",
  "chart.stackedBarChart",
  "chart.groupedBarChart",
  "chart.percentStackedBarChart",
  "chart.horizontalBarChart",
  "chart.lineChart",
  "chart.areaChart",
  "chart.pieChart",
  "chart.donutChart",
  "chart.numberChart",
  "chart.mixedChart",
  "chart.total",
  "chart.countAggregation",
  "chart.sumAggregation",
  "chart.avgAggregation",
  "chart.medianAggregation",
  "chart.minAggregation",
  "chart.maxAggregation",
  "chart.rangeAggregation",
  "chart.uniqueAggregation",
  "chart.emptyAggregation",
  "chart.notEmptyAggregation",
  "chart.percentEmptyAggregation",
  "chart.percentNotEmptyAggregation",
  "chart.checkedAggregation",
  "chart.uncheckedAggregation",
  "chart.percentCheckedAggregation",
  "chart.toolbarType",
  "chart.toolbarGroup",
  "chart.toolbarBucket",
  "chart.toolbarStack",
  "chart.toolbarSeries",
  "chart.toolbarAggregation",
  "chart.toolbarValue",
  "chart.toolbarLineAggregation",
  "chart.toolbarLineValue",
  "chart.recordsValue",
  "chart.exportImage",
  "chart.copyPng",
  "chart.exportedImage",
  "chart.copiedPng",
  "chart.exportUnavailable",
  "chart.dateBucketDay",
  "chart.dateBucketWeek",
  "chart.dateBucketMonth",
  "chart.dateBucketQuarter",
  "chart.dateBucketYear",
  "chart.numberBucketAuto",
  "chart.numberBucketFixed",
  "chart.numberBucketSize",
  "chart.options",
  "chart.optionsData",
  "chart.optionsStyle",
  "chart.optionsExport",
  "chart.autoTitleCount",
  "chart.autoTitleValue",
  "chart.autoTitleCountBy",
  "chart.autoTitleValueBy",
  "chart.autoTitleMixed",
  "chart.autoTitleDateGroup",
  "chart.autoTitleNumberBucketGroup",
  "chart.sortBy",
  "chart.sortOptionOrder",
  "chart.sortValueDesc",
  "chart.sortValueAsc",
  "chart.sortLabelAsc",
  "chart.sortLabelDesc",
  "chart.visibleGroups",
  "chart.visibleGroupsEntry",
  "chart.omitZeroValues",
  "chart.cumulative",
  "chart.title",
  "chart.titleHelp",
  "chart.height",
  "chart.heightSmall",
  "chart.heightMedium",
  "chart.heightLarge",
  "chart.heightXLarge",
  "chart.gridLines",
  "chart.gridNone",
  "chart.gridValue",
  "chart.gridBoth",
  "chart.axisNames",
  "chart.axisNone",
  "chart.axisX",
  "chart.axisY",
  "chart.axisBoth",
  "chart.valueAxisRange",
  "chart.axisAuto",
  "chart.axisZeroBased",
  "chart.axisCustom",
  "chart.axisMin",
  "chart.axisMax",
  "chart.referenceLines",
  "chart.referenceLinesEntry",
  "chart.referenceLineConstant",
  "chart.referenceLineAverage",
  "chart.referenceLineMedian",
  "chart.referenceLineMin",
  "chart.referenceLineMax",
  "chart.referenceLineStyle",
  "chart.referenceLineSolid",
  "chart.referenceLineDashed",
  "chart.referenceLineDotted",
  "chart.referenceLineColor",
  "chart.addReferenceLine",
  "chart.referenceLineColorDefault",
  "chart.referenceLineColorGray",
  "chart.referenceLineColorBlue",
  "chart.referenceLineColorGreen",
  "chart.referenceLineColorAmber",
  "chart.referenceLineColorRed",
  "chart.referenceLineColorPurple",
  "chart.referenceLineColorPink",
  "chart.colorPalette",
  "chart.colorPaletteAuto",
  "chart.colorPaletteAccent",
  "chart.colorPaletteColorful",
  "chart.colorPalettePastel",
  "chart.colorPaletteVivid",
  "chart.colorPaletteWarm",
  "chart.colorPaletteCool",
  "chart.colorPaletteMono",
  "chart.colorPaletteOption",
  "chart.colorByValue",
  "chart.dataLabelMode",
  "chart.dataLabelValue",
  "chart.dataLabelPercent",
  "chart.dataLabelLabelValue",
  "chart.optionsStyleEntry",
  "chart.showTitle",
  "chart.showDataLabels",
  "chart.showLegend",
  "chart.smoothLine",
  "chart.gradientArea",
  "chart.donutCenter",
  "chart.donutCenterHidden",
  "chart.donutCenterTotal",
  "chart.donutCenterAggregation",
  "chart.applyFilter",
  "chart.drilldownSummary",
  "chart.drilldownFile",
  "chart.drilldownPath",
  "chart.drilldownOpenAll",
  "chart.drilldownCopyLinks",
  "chart.drilldownCopiedLinks",
  "chart.drilldownMore",
  "chart.fieldGroup.properties",
  "chart.fieldGroup.formulas",
  "chart.fieldGroup.fileMetadata",
  "chart.disabledBarOnly",
  "chart.disabledLineAreaMixed",
  "chart.disabledDonutOnly",
  "chart.disabledNeedsGroups",
  "chart.disabledCumulative",
  "chart.disabledAggregationForValue",
  "chart.disabledAggregationNeedsValue",
  "chart.disabledAggregationNumericOnly",
  "chart.disabledAggregationCheckboxOnly",
  "viewConfig.chartGroupField",
  "viewConfig.chartGroupFieldNone",
  "viewConfig.chartStackFieldNone",
  "viewConfig.chartValueField",
  "viewConfig.chartValueFieldNone",
  "viewConfig.chartType",
  "viewConfig.chartAggregation",
] as const;

describe("chart view UI wiring", () => {
  it("exposes chart view in toolbar and view settings source paths", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const viewConfig = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const chartToolbar = readFileSync(new URL("../views/ChartToolbarRenderer.ts", import.meta.url), "utf8");
    const dropdown = readFileSync(new URL("../views/DropdownField.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(toolbar).toContain("actions.addView(\"chart\")");
    expect(toolbar).toContain("viewType === \"chart\"");
    expect(toolbar).toContain("if (!isChartView) this.renderSortButton");
    expect(toolbar).toContain("renderChartOptionsButton");
    expect(toolbar).toContain("actions.toggleChartOptions");
    expect(toolbar).toContain("return \"bar-chart\"");
    expect(viewConfig).toContain("{ value: \"chart\", text: t(\"common.chartView\"), icon: \"bar-chart\" }");
    expect(viewConfig).not.toContain("renderChartSettings");
    expect(viewConfig).toContain("createDropdownField");
    expect(viewConfig).not.toContain("const select = row.createEl(\"select\", { cls: \"db-control-select\" })");
    expect(chartToolbar).toContain("togglePopover");
    expect(chartToolbar).toContain("createDropdownField");
    expect(chartToolbar).not.toContain("createEl(\"select\"");
    expect(chartToolbar).toContain("installPopoverAutoClose");
    expect(chartToolbar).toContain("isActiveTarget: (target) => this.isInsideChartPopoverSurface(target)");
    expect(chartToolbar).toContain("target.closest(\".db-chart-options-popover, .db-chart-dropdown-popover\")");
    expect(chartToolbar).toContain("window.activeDocument.addEventListener(\"keydown\", onKeyDown, true)");
    expect(chartToolbar).toContain("if (event.key !== \"Escape\") return");
    expect(chartToolbar).toContain("db-panel-header");
    expect(chartToolbar).toContain("getChartTypeOptions");
    expect(chartToolbar).toContain("getChartStackOptions");
    expect(chartToolbar).toContain("getChartSeriesOptions");
    expect(chartToolbar).toContain("toChartFieldOption");
    expect(chartToolbar).toContain("getChartFieldSection");
    expect(chartToolbar).toContain("section: getChartFieldSection(col)");
    expect(chartToolbar).toContain("PROPERTY_TYPE_ICON_NAMES");
    expect(chartToolbar).toContain("searchable: isFieldPicker");
    expect(chartToolbar).toContain("getDateBucketOptions");
    expect(chartToolbar).toContain("db-chart-options-popover");
    expect(chartToolbar).toContain("openChildPopover");
    expect(chartToolbar).toContain("db-chart-subpopover");
    expect(chartToolbar).toContain("isInsideChartDropdownPopover");
    expect(chartToolbar).toContain("this.isInsideChartDropdownPopover(target)");
    const autoClose = readFileSync(new URL("../views/PopoverAutoClose.ts", import.meta.url), "utf8");
    expect(autoClose).toContain("isActiveTarget?(target: EventTarget | null): boolean");
    expect(autoClose).toContain("pointerInsideLinkedSurface");
    expect(autoClose).toContain("options.isActiveTarget?.(event.target)");
    expect(chartToolbar).toContain("ChildPopoverSizeOptions");
    expect(chartToolbar).toContain("preferredWidth: 280");
    expect(chartToolbar).toContain("panel.style.width = `${width}px`");
    expect(chartToolbar).toContain("const rawLeft = useRight ? anchorRect.right + gap : anchorRect.right - width");
    expect(chartToolbar).toContain("db-toggle-switch");
    expect(chartToolbar).toContain("chart.optionsData");
    expect(chartToolbar).toContain("chart.optionsStyle");
    expect(chartToolbar).toContain("chart.optionsExport");
    expect(viewConfig).not.toContain("renderChartStyleSettings");
    expect(viewConfig).not.toContain("config.chartTitle");
    expect(chartToolbar).toContain("renderTextInput");
    expect(chartToolbar).toContain("config.chartTitle");
    expect(chartToolbar).toContain("getChartAutoTitle");
    expect(chartToolbar).toContain("chart:ruler-vertical");
    expect(chartToolbar).toContain("chart:grid-horizontal");
    expect(chartToolbar).toContain("chart:axis-xy");
    expect(chartToolbar).toContain("chart:data-labels");
    expect(chartToolbar).toContain("config.chartType = value as ChartType");
    expect(chartToolbar).toContain("config.chartDateBucket = value as ChartDateBucket");
    expect(chartToolbar).toContain("config.chartSeriesField = value || undefined");
    expect(chartToolbar).toContain("config.chartStackField = config.chartSeriesField");
    expect(chartToolbar).toContain("setChartAggregation(config, slot");
    expect(chartToolbar).toContain("config.chartSecondaryValueField = value");
    expect(chartToolbar).toContain("closeOnSelect: false");
    expect(chartToolbar).toContain("syncChartAggregationSelection");
    expect(chartToolbar).not.toContain("this.openValueAggregationPopover(containerEl, anchor, config, actions, slot);");
    expect(chartToolbar).toContain("onExportImage");
    expect(chartToolbar).toContain("onCopyPng");
    expect(chartToolbar).not.toContain("onCopyCanvasCode");
    expect(chartToolbar).toContain("db-chart-options-export");
    expect(chartToolbar).toContain("chart.copyPng");
    expect(chartToolbar).not.toContain("chart.copyCanvasCode");
    expect(chartToolbar).toContain("config.chartDataLabelColor");
    expect(chartToolbar).toContain("refreshOpenPopover(containerEl, config, actions)");
    expect(chartToolbar).toContain("isChartGroupColumn");
    expect(chartToolbar).toContain("isChartDateGroupColumn");
    expect(chartToolbar).toContain("isChartNumberGroupColumn");
    expect(chartToolbar).toContain("getDefaultChartNumberBucket");
    expect(chartToolbar).toContain("config.chartNumberBucket = value as ChartNumberBucket");
    expect(chartToolbar).toContain("config.chartNumberBucketSize");
    expect(chartToolbar).toContain("getDefaultChartValueField");
    expect(chartToolbar).toContain("isChartAggregationValueColumn");
    expect(chartToolbar).toContain("requiresChartValueField");
    expect(chartToolbar).toContain("config.chartAggregation = value");
    expect(chartToolbar).toContain("if (!requiresChartValueField(config.chartAggregation)) config.chartValueField = undefined");
    expect(chartToolbar).toContain("config.chartValueField = value");
    expect(chartToolbar).toContain("openValueAggregationPopover");
    expect(chartToolbar).toContain("renderValueAggregationPopover");
    expect(chartToolbar).toContain("getOrderedChartAggregationOptions");
    expect(chartToolbar).toContain("const enabled = options.filter((option) => !option.disabled)");
    expect(chartToolbar).toContain("const disabled = options.filter((option) => option.disabled)");
    expect(chartToolbar).not.toContain("this.renderSelect(section, t(\"chart.toolbarAggregation\")");
    expect(chartToolbar.indexOf("t(\"chart.toolbarValue\")")).toBeLessThan(chartToolbar.indexOf("t(\"chart.toolbarAggregation\")"));
    const styleEntry = chartToolbar.slice(
      chartToolbar.indexOf("private renderStyleEntry"),
      chartToolbar.indexOf("private openStylePopover")
    );
    const stylePopover = chartToolbar.slice(
      chartToolbar.indexOf("private renderStyleSection"),
      chartToolbar.indexOf("private openReferenceLinesPopover")
    );
    expect(styleEntry).toContain("t(\"chart.colorPalette\")");
    expect(styleEntry).toContain("t(\"chart.colorByValue\")");
    expect(stylePopover).not.toContain("t(\"chart.colorPalette\")");
    expect(stylePopover).not.toContain("t(\"chart.colorByValue\")");
    expect(chartToolbar).toContain("config.chartHiddenGroups");
    expect(chartToolbar).toContain("config.chartCumulative");
    expect(chartToolbar).toContain("config.chartShowDataLabels");
    expect(chartToolbar).toContain("config.chartValueAxisRange");
    expect(chartToolbar).toContain("config.chartValueAxisMin");
    expect(chartToolbar).toContain("config.chartValueAxisMax");
    expect(chartToolbar).toContain("config.chartReferenceLines");
    expect(chartToolbar).toContain("renderReferenceLinesSection(section, config, actions)");
    expect(chartToolbar).toContain("db-chart-reference-lines-inline");
    expect(chartToolbar).toContain("chart.addReferenceLine");
    expect(chartToolbar).toContain("renderReferenceLineColorPicker");
    expect(chartToolbar).toContain("REFERENCE_LINE_COLORS");
    expect(chartToolbar).not.toContain("renderTextInput(wrap, t(\"chart.referenceLineColor\")");
    expect(chartToolbar).not.toContain("const addAverage =");
    expect(chartToolbar).not.toContain("openReferenceLinesPopover");
    expect(chartToolbar).not.toContain("openChildPopoverFromRect");
    expect(chartToolbar).toContain("config.chartColorPalette");
    expect(chartToolbar).toContain("config.chartColorByValue");
    expect(chartToolbar).toContain("chart.colorPalettePastel");
    expect(chartToolbar).toContain("getChartPalettePreviewColors");
    expect(chartToolbar).toContain("swatches:");
    expect(chartToolbar).toContain("config.chartDataLabelMode");
    expect(chartToolbar).toContain("getDonutCenterModeOptions");
    expect(chartToolbar).toContain("config.chartDonutCenterMode");
    expect(chartToolbar).toContain("disabledReason");
    expect(chartToolbar).toContain("t(\"chart.disabledBarOnly\")");
    expect(chartToolbar).toContain("t(\"chart.disabledLineAreaMixed\")");
    expect(chartToolbar).toContain("t(\"chart.disabledDonutOnly\")");
    expect(chartToolbar).toContain("t(\"chart.disabledNeedsGroups\")");
    expect(chartToolbar).toContain("t(\"chart.disabledCumulative\")");
    expect(chartToolbar).toContain("getChartAggregationDisabledReason");
    expect(chartToolbar).toContain("t(\"chart.disabledAggregationNumericOnly\")");
    expect(chartToolbar).toContain("t(\"chart.disabledAggregationCheckboxOnly\")");
    expect(chartToolbar).toContain("renderDisabledReason");
    expect(chartToolbar).toContain("db-chart-options-disabled-reason");
    expect(dropdown).toContain("disabledReason?: string");
    expect(dropdown).toContain("swatches?: string[]");
    expect(dropdown).toContain("db-dropdown-option-swatches");
    expect(dropdown).toContain("export interface DropdownOption");
    expect(dropdown).toContain("export function createDropdownField");
    expect(dropdown).toContain("db-dropdown-field");
    expect(dropdown).toContain("db-dropdown-popover");
    expect(dashboard).toContain("private chartToolbarRenderer = new ChartToolbarRenderer()");
    expect(dashboard).toContain("toggleChartOptions: (anchorEl) => this.toggleChartOptions(anchorEl)");
    expect(dashboard).toContain("this.chartToolbarRenderer.togglePopover");
    expect(dashboard).toContain("this.chartRenderer.exportPng");
    expect(dashboard).toContain("this.chartRenderer.copyPng");
    expect(dashboard).not.toContain("this.chartRenderer.copyCanvasCode");
    const dashboardChartOptions = dashboard.slice(
      dashboard.indexOf("private toggleChartOptions"),
      dashboard.indexOf("private isHeaderPopoverVisible")
    );
    expect(dashboardChartOptions).toContain("this.renderChart(config)");
    expect(dashboardChartOptions).not.toContain("this.refresh()");
    expect(dashboard).toContain(".db-chart-number");
    expect(embedded).toContain("private chartToolbarRenderer = new ChartToolbarRenderer()");
    expect(embedded).toContain("toggleChartOptions: (anchorEl) => this.toggleChartOptions(config, anchorEl)");
    expect(embedded).toContain("this.chartToolbarRenderer.togglePopover");
    expect(embedded).toContain("this.persistMode === \"codeblock\"");
    expect(embedded).toContain("this.chartRenderer.copyPng");
    expect(embedded).not.toContain("this.chartRenderer.copyCanvasCode");
    const embeddedChartOptions = embedded.slice(
      embedded.indexOf("private toggleChartOptions"),
      embedded.indexOf("private getChartExportFilename")
    );
    expect(embeddedChartOptions).toContain("this.renderChartOnly(config)");
    expect(embeddedChartOptions).not.toContain("this.renderResults(config)");
    expect(embedded).toContain("private renderChartOnly(config: ViewConfig)");
    expect(embedded).toContain(".db-chart-number");
  });

  it("keeps chart titles and data labels from colliding with the plot", () => {
    const renderer = readFileSync(new URL("../views/ChartRenderer.ts", import.meta.url), "utf8");

    expect(renderer).toContain("wrap.addClass(\"has-chart-title\")");
    expect(renderer).toContain("top: showTitle ? (config?.chartShowDataLabels === true ? 52 : 42)");
    expect(renderer).toContain("valueAxisGrace");
    expect(renderer).toContain("grace: !isHorizontal ? valueAxisGrace : undefined");
    expect(renderer).toContain("placeInsideBars: isStacked || isPercentStacked");
    expect(renderer).not.toContain("const drawnBoxes: DataLabelBox[] = []");
    expect(renderer).not.toContain("boxesOverlap");
    expect(renderer).not.toContain("isBoxInsideChartArea");
    expect(renderer).toContain("const labelBackground = point.isInsideMark ? getDatasetBackgroundColor(dataset, index) : colors.background");
    expect(renderer).toContain("getDataLabelColor(colorMode, colors, labelBackground)");
    expect(renderer).toContain("getRelativeLuminance(background)");
    expect(renderer).not.toContain("isPointInsideBar");
  });

  it("keeps chart export helpers scoped to canvas-compatible output", () => {
    const chartRenderer = readFileSync(new URL("../views/ChartRenderer.ts", import.meta.url), "utf8");

    expect(chartRenderer).toContain("copyPng(): Promise<boolean>");
    expect(chartRenderer).toContain("new ClipboardItemCtor({ [blob.type]: blob })");
    expect(chartRenderer).toContain("dataUrlToBlob(capture.dataUrl)");
    expect(chartRenderer).not.toContain("copyCanvasCode(filename: string)");
    expect(chartRenderer).not.toContain("buildCanvasCode(capture");
    expect(chartRenderer).not.toContain("exportSvg(filename: string)");
  });

  it("renders the chart options button near the right edge before search", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const chartIndex = toolbar.indexOf("this.renderChartOptionsButton(right, actions)");
    const settingsIndex = toolbar.indexOf("this.renderViewConfigButton(right, actions)");
    const exportIndex = toolbar.indexOf("this.renderExportButton(right, actions)");
    const searchIndex = toolbar.indexOf("if (!phoneLayout) this.renderSearch(right, state, actions)");

    expect(settingsIndex).toBeGreaterThan(0);
    expect(exportIndex).toBeGreaterThan(settingsIndex);
    expect(chartIndex).toBeGreaterThan(exportIndex);
    expect(searchIndex).toBeGreaterThan(chartIndex);
  });

  it("keeps chart-applied filters in the normal undoable filter config path", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const applyChartFilters = dashboard.slice(
      dashboard.indexOf("private applyChartFilters"),
      dashboard.indexOf("private getBoardSubgroups")
    );

    expect(applyChartFilters).toContain("this.pendingUndoLabel = t(\"undo.filterConfig\")");
    expect(applyChartFilters).toContain("this.viewStateStore.persist(config, state)");
    expect(applyChartFilters).toContain("this.scheduleConfigSave()");
  });

  it("defines all chart i18n keys in English and Chinese locales", () => {
    for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
      setLocale(locale);
      for (const key of chartKeys) {
        expect(t(key), `${locale}:${key}`).not.toBe(key);
      }
    }
    setLocale("system");
  });

  it("includes shared chart styles for dashboard and embedded containers", () => {
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(styles).toContain(".note-database-container .db-chart");
    expect(styles).toContain(".note-database-container .db-chart-options-popover");
    expect(styles).toContain("max-height: min(620px, calc(100vh - 140px))");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain(".note-database-container .db-dropdown-field");
    expect(styles).toContain(".note-database-container .db-dropdown-popover");
    expect(styles).toContain(".note-database-container .db-dropdown-section-title");
    expect(styles).toContain(".note-database-container .db-chart-subpopover");
    expect(styles).toContain(".note-database-container .db-toggle-switch");
    expect(styles).toContain(".note-database-container .db-chart-empty");
    expect(styles).toContain(".note-database-container .db-chart-number");
    expect(styles).toContain("border: 0");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain(".note-database-container.db-view-chart");
    expect(styles).toContain(".is-mobile .note-database-container .db-chart");
    expect(styles).toContain(".is-phone .note-database-container .db-chart-options-popover");
    expect(styles).toContain("max-height: min(380px, calc(100vh - 240px))");
    expect(styles).toContain("width: 100%");
    expect(styles).toContain("max-width: none");
    expect(styles).toContain("max-height: 30vh");
    expect(styles).toContain("overscroll-behavior: contain");
    expect(styles).toContain(".note-database-container .db-board-column-header::before");
    expect(styles).toContain(".note-database-container .db-board-subgroup-header::before");
    expect(styles).toContain("inset: -6px -4px 0");
  });

  it("wires embedded headerless mode and search focus affordance", () => {
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(embedded).toContain("note-database-embed-headerless");
    expect(embedded).toContain("shouldHideHeaderChrome");
    expect(embedded).toContain("renderHeaderChromeToggle");
    expect(embedded).toContain("toggleHeaderChrome");
    expect(embedded).toContain("saveDescriptionScroll");
    expect(embedded).toContain("restoreDescriptionScroll");
    expect(dashboard).toContain("saveDescriptionScrollPosition");
    expect(dashboard).toContain("restoreDescriptionScrollPosition");
    expect(dashboard).not.toContain("saveScrollPosition");
    expect(dashboard).not.toContain("restoreScrollPosition");
    expect(embedded).toContain("options.hideHeader");
    expect(embedded).toContain("options.hideToolbar");
    expect(embedded).toContain("options.header");
    expect(embedded).toContain("hideHeader: true");
    expect(toolbar).toContain("readonly hideHeaderChrome?: boolean");
    expect(toolbar).toContain("toggleHeaderChrome?(hidden: boolean): void");
    expect(toolbar).toContain("if (actions.hideHeaderChrome) return");
    expect(toolbar).toContain("readonly showChartOptions?: boolean");
    expect(toolbar).toContain("if (isChartView && actions.toggleChartOptions && actions.showChartOptions === true)");
    expect(embedded).toContain("isReadOnlyViews: true");
    expect(embedded).toContain("showChartOptions: this.persistMode !== \"codeblock\"");
    expect(embedded).toContain("toggleChartOptions: (anchorEl) => this.toggleChartOptions(config, anchorEl)");
    expect(embedded).toContain("if (config.viewType !== \"chart\" || this.persistMode === \"codeblock\") return;");
    expect(dashboard).toContain("toggleChartOptions: (anchorEl) => this.toggleChartOptions(anchorEl)");
    expect(dashboard).toContain("showChartOptions: true");
    expect(toolbar).toContain("renderHeaderChromeButton");
    expect(toolbar).toContain("searchInput.focus()");
    expect(toolbar).toContain("searchInput.setSelectionRange");
    expect(styles).toContain(".note-database-embed-headerless.note-database-container");
    expect(styles).toContain(".note-database-embed.note-database-container > .db-header");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain("pointer-events: none");
    expect(styles).toContain(".note-database-embed.note-database-container > .db-header > *");
    expect(styles).toContain(".note-database-embed.note-database-container > .db-embed-header-toggle");
    expect(styles).toContain(".note-database-container .db-description:not(.is-scrolling):not(:hover)::-webkit-scrollbar-thumb");
    expect(styles).toContain(".note-database-embed.note-database-container table.db-table th.db-drop-target");
  });

  it("defines embedded header toggle labels in all locales", () => {
    for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
      setLocale(locale);
      expect(t("toolbar.hideEmbedHeader")).not.toBe("toolbar.hideEmbedHeader");
      expect(t("toolbar.showEmbedHeader")).not.toBe("toolbar.showEmbedHeader");
      expect(t("undo.databaseDescriptionConfig")).not.toBe("undo.databaseDescriptionConfig");
      expect(t("filter.hasTag")).not.toBe("filter.hasTag");
    }
    setLocale("system");
  });
});
