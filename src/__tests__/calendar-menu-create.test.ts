import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(join(__dirname, "..", rel), "utf8");

/**
 * 回归：右键菜单「在上方/下方添加条目」曾被浮层抑制逻辑静默吞掉。
 * Obsidian 菜单项回调执行时 .menu 仍在 DOM（先回调后隐藏），且 mousedown
 * 捕获已把 suppressNextCreate 置 true——菜单命令必须绕过抑制（fromMenuCommand）。
 * DatabaseView 依赖 obsidian，无法在 node 环境直测，用源码断言锁定接线。
 */
describe("row-menu create entry bypasses overlay suppression", () => {
  const view = read("views/DatabaseView.ts");

  it("guardedCreateEntry skips suppression for explicit menu commands", () => {
    expect(view).toContain("!options?.fromMenuCommand && (this.suppressNextCreate || this.hasActiveOverlay())");
    // 抑制标志仍需消费：菜单点击后紧跟的「+」按钮首击不应被残留标志误吞。
    expect(view).toMatch(/fromMenuCommand[\s\S]{0,200}this\.suppressNextCreate = false/);
  });

  it("RowMenu wiring marks its createEntry as a menu command", () => {
    expect(view).toContain("this.guardedCreateEntry(defaults, position, { fromMenuCommand: true })");
    // 渲染器（表格/看板/画廊/列表的「+」按钮）是直接点击，保持抑制语义。
    const guarded = view.match(/createEntry: \(defaults, position\) => this\.guardedCreateEntry\(defaults, position\),/g) || [];
    expect(guarded.length).toBeGreaterThanOrEqual(4);
  });
});

/**
 * 回归：嵌入日历曾把每次渲染新建的 {...config} 克隆（renderConfig）传给
 * CalendarRenderer——列宽拖拽/月份导航的原地修改全部丢失，松手回弹。
 * 必须传工作副本 this.config（与 DatabaseView 直传一致）。
 */
describe("embedded calendar receives the mutable working config", () => {
  const embed = read("views/EmbeddedDatabaseRenderer.ts");

  it("calendar branch passes the live config, not the per-render clone", () => {
    expect(embed).toContain("this.calendarRenderer.render(target, config, this.rows)");
    expect(embed).not.toContain("this.calendarRenderer.render(target, renderConfig");
    // 其余视图（看板/画廊/列表/图表）继续用带状态注入的 renderConfig。
    expect(embed.match(/renderGrouped\(target, renderConfig/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * 回归：viewEntries 被 rebuildViewEntries 整体替换后，捕获配置对象的
 * 常驻弹层闭包立即失效——继续交互会写进游离对象（表现为「列宽只能调一次」）。
 * 日历选项弹窗 rebind 换新闭包并保持打开；图表/时间线选项关闭；数据库选择
 * 弹窗豁免（moveDatabase 拖拽排序依赖它跨 rebuild 保持打开，1.3.1 行为）。
 */
describe("config-capturing popovers survive viewEntries rebuild safely", () => {
  const view = read("views/DatabaseView.ts");
  const toolbar = read("views/ToolbarRenderer.ts");

  it("rebuildViewEntries preserves identity for semantically-equal configs", () => {
    const rebuild = view.slice(view.indexOf("private rebuildViewEntries(): boolean"));
    const body = rebuild.slice(0, rebuild.indexOf("private hasSameViewEntryStructure"));
    expect(body).toContain("configsSemanticEqual(previous, df.config) ? previous : df.config");
    // 弹窗同步只在配置对象真的被替换时执行（回声不关弹窗、不 rebind）。
    expect(body).toContain("if (configReplaced) this.syncConfigBoundPopovers();");
    // peer 覆盖（hardRefreshFromSource 的 databaseOverride 二次替换）之后再次同步。
    expect(view).toContain("if (databaseOverride) this.syncConfigBoundPopovers();");
  });

  it("syncConfigBoundPopovers rebinds calendar and closes chart/timeline popovers", () => {
    const method = view.slice(view.indexOf("private syncConfigBoundPopovers(): void"));
    const body = method.slice(0, method.indexOf("private hasSameViewEntryStructure") > -1 ? method.indexOf("private hasSameViewEntryStructure") : undefined);
    expect(body).toContain("this.calendarToolbarRenderer.rebind(calendarConfig, this.buildCalendarPopoverActions(calendarConfig))");
    expect(body).toContain("this.chartToolbarRenderer.closePopover()");
    expect(body).toContain("this.toolbarRenderer.closeConfigEditingPopovers()");
    // 数据库选择弹窗不在此关闭（moveDatabase 豁免）。
    expect(body).not.toContain("closePopovers()");
  });

  it("definition-change branch skips re-render on pure echo", () => {
    expect(view).toContain("const material = this.rebuildViewEntries();");
    expect(view).toMatch(/if \(material\) \{\s*this\.rerenderToolbar\(\);\s*this\.refresh\(\);/);
  });

  it("popover open and rebind share the same actions builder", () => {
    expect(view).toContain("this.buildCalendarPopoverActions(config)");
    expect(view.match(/buildCalendarPopoverActions\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("ToolbarRenderer.closeConfigEditingPopovers only touches the timeline options popover", () => {
    const method = toolbar.slice(toolbar.indexOf("closeConfigEditingPopovers(): void"));
    expect(method.slice(0, method.indexOf("private static readonly ICONS"))).toContain(
      "this.calendarTimelineToolbarRenderer.closePopover();",
    );
  });

  it("auto-close never fires while the pointer is really over the panel (:hover ground truth)", () => {
    const autoClose = read("views/PopoverAutoClose.ts");
    // range 拖拽的指针捕获会让 pointerenter/leave 失真；:hover 兜底保证
    // 「鼠标在面板内持续拖滑杆」永不触发空闲关闭。
    expect(autoClose).toContain('options.panel.matches(":hover")');
  });
});
