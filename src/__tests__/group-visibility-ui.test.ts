import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";

describe("group visibility toolbar UI", () => {
  it("renders empty-group visibility as a first-section switch that keeps the popover open", () => {
    const toolbar = readFileSync("src/views/ToolbarRenderer.ts", "utf8");
    expect(toolbar).toContain("t(\"toolbar.groupOptions\")");
    expect(toolbar).toContain("isEmptyGroupVisibilityColumn(config, groupColumn)");
    expect(toolbar).toContain("renderGroupVisibilitySwitch");
    expect(toolbar).toContain("actions.setShowEmptyGroups(field, input.checked)");
    expect(toolbar).toContain("this.rebuildGroupPopover()");
  });

  it("adds empty option groups in render paths instead of filtering uncategorized rows", () => {
    const queryEngine = readFileSync("src/data/QueryEngine.ts", "utf8");
    const dashboard = readFileSync("src/views/DatabaseView.ts", "utf8");
    const embedded = readFileSync("src/views/EmbeddedDatabaseRenderer.ts", "utf8");

    expect(queryEngine).not.toContain("showEmptyGroups");
    expect(queryEngine).not.toContain("isEmptyGroupValue");
    expect(dashboard).toContain("withEmptyOptionGroups(config, field, this.queryEngine.groupBy");
    expect(embedded).toContain("withEmptyOptionGroups(config, field, this.queryEngine.groupBy");
  });

  it("keeps empty-group visibility changes on lightweight result refresh paths", () => {
    const dashboard = readFileSync("src/views/DatabaseView.ts", "utf8");
    const embedded = readFileSync("src/views/EmbeddedDatabaseRenderer.ts", "utf8");

    expect(dashboard).toContain("setShowEmptyGroups(config, field, value)");
    expect(dashboard).toContain("this.scheduleConfigSave()");
    expect(dashboard).toContain('this.refresh({ viewport: "reset-top" })');

    expect(embedded).toContain("setShowEmptyGroups(config, field, value)");
    expect(embedded).toContain('this.renderResults(config, { viewport: "reset-top" })');
    expect(embedded).not.toContain("setShowEmptyGroups: (field, value) => {\n        setShowEmptyGroups(config, field, value);\n        this.persistEmbeddedConfigLocally(config);\n        this.rerenderToolbar(config);");
    expect(embedded).toContain("this.updateToolbarIndicators(config);\n        this.renderResults(config, { viewport: \"reset-top\" });\n        this.saveEmbeddedConfigInBackground();\n      },\n      setShowEmptyGroups");
  });

  it("includes i18n labels for the group options switch", () => {
    const i18n = readFileSync("src/i18n.ts", "utf8");
    for (const key of ["toolbar.groupOptions", "toolbar.showEmptyGroup"]) {
      expect(i18n.match(new RegExp(`"${key}"`, "g"))?.length).toBe(3);
    }
  });
});

describe("board subgroup controls in group popover", () => {
  it("renders board subgroup controls behind an enable switch and keeps choices in the same popover", () => {
    const toolbar = readFileSync("src/views/ToolbarRenderer.ts", "utf8");

    expect(toolbar).toContain("setBoardSubgroupEnabled(enabled: boolean): void");
    expect(toolbar).toContain("setBoardSubgroupField(value: string): void");
    expect(toolbar).toContain("renderBoardSubgroupSwitch");
    expect(toolbar).toContain("renderBoardSubgroupSection");
    expect(toolbar).toContain("t(\"toolbar.enableBoardSubgroups\")");
    expect(toolbar).toContain("t(\"toolbar.subgroupBy\")");
    expect(toolbar).toContain("actions.setBoardSubgroupEnabled(input.checked)");
    expect(toolbar).toContain("actions.setBoardSubgroupField(col.key)");
    expect(toolbar).toContain("this.rebuildGroupPopover()");
  });

  it("filters the current board group field out of subgroup choices and does not render a no-subgroup option row", () => {
    const toolbar = readFileSync("src/views/ToolbarRenderer.ts", "utf8");
    const styles = readFileSync("styles.css", "utf8");

    expect(toolbar).toContain("getBoardSubgroupCandidates");
    expect(toolbar).toContain("col.key !== groupValue");
    expect(toolbar).toContain('col.key !== "file.name"');
    expect(toolbar).toContain("t(\"toolbar.selectBoardSubgroupField\")");
    expect(toolbar).toContain("t(\"toolbar.noAvailableBoardSubgroupFields\")");
    expect(styles).toContain(".note-database-container .db-group-popover-row.is-disabled");
    expect(styles).toContain("cursor: default");
    expect(toolbar).not.toContain("label: t(\"viewConfig.noSubgroup\")");
    expect(toolbar).not.toContain("label: t(\"common.noGroup\"),\n        token: \"–\",\n        active: !subgroupField");
  });

  it("wires board subgroup toolbar actions in full and embedded views without rerendering the toolbar", () => {
    const dashboard = readFileSync("src/views/DatabaseView.ts", "utf8");
    const embedded = readFileSync("src/views/EmbeddedDatabaseRenderer.ts", "utf8");

    for (const source of [dashboard, embedded]) {
      expect(source).toContain("setBoardSubgroupEnabled: (enabled) =>");
      expect(source).toContain("setBoardSubgroupField: (value) =>");
      expect(source).toContain("config.boardSubgroupEnabled = enabled");
      expect(source).toContain("config.boardSubgroupField = subgroupField || undefined");
      expect(source).toContain("config.boardSubgroupField = undefined");
      expect(source).toContain('viewport: "reset-top"');
    }
    expect(embedded).not.toContain("setBoardSubgroupEnabled: (enabled) => {\n        config.boardSubgroupEnabled = enabled;\n        this.rerenderToolbar(config);");
  });

  it("requires board render paths to respect an explicitly disabled subgroup switch", () => {
    const board = readFileSync("src/views/BoardRenderer.ts", "utf8");
    const dashboard = readFileSync("src/views/DatabaseView.ts", "utf8");
    const embedded = readFileSync("src/views/EmbeddedDatabaseRenderer.ts", "utf8");
    const dataSource = readFileSync("src/data/DataSource.ts", "utf8");

    expect(board).toContain("config.boardSubgroupEnabled !== false && config.boardSubgroupField");
    expect(dashboard).toContain("config.boardSubgroupEnabled !== false && config.boardSubgroupField");
    expect(embedded).toContain("config.boardSubgroupEnabled !== false && config.boardSubgroupField");
    expect(dataSource).toContain("boardSubgroupEnabled: view.boardSubgroupEnabled ?? Boolean(view.boardSubgroupField)");
  });

  it("keeps subgroup enabled when a board group change invalidates the current subgroup field", () => {
    const dashboard = readFileSync("src/views/DatabaseView.ts", "utf8");
    const embedded = readFileSync("src/views/EmbeddedDatabaseRenderer.ts", "utf8");

    expect(dashboard).toContain("this.normalizeBoardSubgroupAfterGroupChange(config, value)");
    expect(embedded).toContain("this.normalizeBoardSubgroupAfterGroupChange(config, value)");
    expect(dashboard).toContain("if (config.boardSubgroupField === groupField) config.boardSubgroupField = undefined");
    expect(embedded).toContain("if (config.boardSubgroupField === groupField) config.boardSubgroupField = undefined");
  });

  it("includes i18n labels for board subgroup popover controls", () => {
    const i18n = readFileSync("src/i18n.ts", "utf8");
    for (const key of [
      "toolbar.enableBoardSubgroups",
      "toolbar.subgroupBy",
      "toolbar.selectBoardSubgroupField",
      "toolbar.noAvailableBoardSubgroupFields",
    ]) {
      expect(i18n.match(new RegExp(`"${key}"`, "g"))?.length).toBe(3);
    }
  });
});

describe("group popover selection freshness", () => {
  it("opens the group popover from the live config, not a frozen onclick-closure snapshot", () => {
    const toolbar = readFileSync("src/views/ToolbarRenderer.ts", "utf8");
    // 分组按钮 onclick 不再把「工具栏渲染时冻结的 groupValue 快照」传给 popover
    expect(toolbar).not.toContain("renderGroupPopover(btn, config, currentViewType, groupValue");
    // 新增共享 helper，供「打开」与「立即刷新」实时解析当前分组字段
    expect(toolbar).toContain("private resolveGroupValue(");
    // renderGroupPopover 入口处实时重算 groupValue，而非接收冻结参数
    expect(toolbar).toContain("const groupValue = this.resolveGroupValue(config, currentViewType, state);");
    // rebuildGroupPopover 复用同一 helper，避免取值逻辑重复
    expect(toolbar).toContain("const groupValue = this.resolveGroupValue(config, viewType, state);");
  });
});
