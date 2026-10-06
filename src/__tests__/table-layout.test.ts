import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getFrozenColumnOffsets, normalizeFrozenColumnCount } from "../views/TableLayout";

describe("frozen table layout", () => {
  it("clamps the persisted freeze count to five visible columns", () => {
    expect(normalizeFrozenColumnCount(undefined, 8)).toBe(0);
    expect(normalizeFrozenColumnCount(-2, 8)).toBe(0);
    expect(normalizeFrozenColumnCount(3.9, 8)).toBe(3);
    expect(normalizeFrozenColumnCount(9, 8)).toBe(5);
    expect(normalizeFrozenColumnCount(9, 3)).toBe(3);
  });

  it("places data columns after all leading utility columns", () => {
    expect(getFrozenColumnOffsets([40, 28], [120, 80, 160], 2)).toEqual({
      leading: [0, 40],
      data: [68, 188, 268],
    });
  });

  it("does not advance the offset after the unfrozen boundary", () => {
    expect(getFrozenColumnOffsets([40], [100, 100, 100], 1)).toEqual({
      leading: [0],
      data: [40, 140, 140],
    });
  });

  /**
   * 回归：可填充单元格的 `td.db-fillable-cell { position: relative }` 特异性为
   * (0,3,1)；嵌入态表头 `.note-database-embed... table.db-table th { position:
   * relative }` 为 (0,3,2) 且位于文件后方（平手时后者胜——嵌入选择列表头曾
   * 因此钉不住）。冻结 sticky 选择器必须是 (0,3,3)（带 table + tbody/thead
   * + td/th）严格最高，否则 sticky 失效，冻结偏移的 left 沦为 relative 位移。
   */
  it("frozen sticky selectors outrank fillable-cell and embed-header position rules", () => {
    const css = readFileSync(join(__dirname, "..", "..", "styles.css"), "utf8");
    expect(css).toContain("td.db-fillable-cell {\n  position: relative");
    expect(css).toMatch(/\.note-database-embed\.note-database-container table\.db-table th \{/);
    expect(css).toContain(".note-database-container table.db-table tbody td.db-frozen-cell");
    expect(css).toContain(".note-database-container table.db-table thead th.db-frozen-cell");
    // 纯类选择器（0,3,0，会被上述两条规则平手或压过）不得再单独承担 sticky。
    expect(css).not.toMatch(/\.db-table \.db-frozen-cell \{\s*\n\s*position: sticky/);
  });

  /**
   * 回归：顶部汇总栏（.db-summary）横向 sticky。块级默认宽度=包含块宽，
   * sticky 位移余量为 0 钉不住——必须 width:fit-content；嵌入态曾有
   * `> .db-summary { position: relative }` 覆盖（0,3,0 > 基础规则 0,2,0）。
   * 主视图的 6px 缩进必须用 padding 而非 margin：margin 在 border box 外，
   * sticky 钉住时被丢弃——起滚瞬间汇总栏左跳 6px（绝对位置偏移）。
   */
  it("top summary bar pins horizontally in both main and embed contexts", () => {
    const css = readFileSync(join(__dirname, "..", "..", "styles.css"), "utf8");
    expect(css).toMatch(/\.note-database-container \.db-summary \{[^}]*position: sticky[^}]*width: fit-content/s);
    expect(css).toMatch(/\.note-database-embed\.note-database-container > \.db-summary \{[^}]*position: sticky/s);
    const mainIndent = css.match(/\.note-database-container:not\(\.note-database-embed\) > \.db-summary \{[^}]*/s)?.[0] || "";
    expect(mainIndent).toContain("margin-left: 0");
    expect(mainIndent).toContain("padding-left: 6px");
  });

  /**
   * 回归：可编辑嵌入块的列菜单曾把冻结项禁用——displayOnly（「schema 级
   * 操作回主视图改」）被并入派生 readonly，而冻结是展示级 view config，
   * 与换行/隐藏/数字样式同类。禁用条件改为显式 options.readonly；只读
   * 嵌入整组隐藏（其 freezeColumn 本就是 no-op）。
   */
  it("editable embeds can change frozen columns via the column menu", () => {
    const menu = readFileSync(join(__dirname, "..", "views", "ColumnMenu.ts"), "utf8");
    const embed = readFileSync(join(__dirname, "..", "views", "EmbeddedDatabaseRenderer.ts"), "utf8");
    const freezeSection = menu.slice(menu.indexOf("const freezeState"), menu.indexOf("menu.addSeparator();", menu.indexOf("const freezeState")));
    expect(freezeSection).toContain("options.readonly === true");
    expect(freezeSection).not.toMatch(/setDisabled\(readonly\)/);
    expect(embed).toContain("this.isEmbedReadOnly() ? undefined : this.getColumnFreezeState(config, column)");
  });

  /**
   * 回归：frozenColumnCount 必须进 DataSource 序列化/解析白名单——曾漏加，
   * 冻结设置从不落盘：重启即丢，且保存 10 秒后（override 过期）从磁盘重解析
   * 的 rebuild 会静默丢字段。
   */
  it("frozenColumnCount persists through the view-def whitelist", () => {
    const ds = readFileSync(join(__dirname, "..", "data", "DataSource.ts"), "utf8");
    const serialize = ds.slice(ds.indexOf("frozenColumnCount: typeof view.frozenColumnCount"));
    expect(serialize.slice(0, 120)).toContain("view.frozenColumnCount > 0");
    expect((ds.match(/frozenColumnCount: this\.parsePositiveNumber\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * 回归：分组头的汇总栏（.db-group-summary-item）此前不随分组名横向钉住。
   * header 自身被 flex 拉伸到与容器同宽（sticky 位移余量为 0，left 钉不住），
   * label 与汇总必须包进 .db-group-header-sticky 内层一起 sticky。
   */
  it("group header summaries render into the horizontally sticky wrapper", () => {
    const css = readFileSync(join(__dirname, "..", "..", "styles.css"), "utf8");
    const renderer = readFileSync(join(__dirname, "..", "views", "TableRenderer.ts"), "utf8");
    expect(css).toContain(".db-group-header .db-group-header-sticky");
    expect(renderer).toContain('groupHeader.createSpan({ cls: "db-group-header-sticky" })');
    expect(renderer).toContain("renderGroupSummaries?.(stickyInfo");
    expect(renderer).not.toContain("renderGroupSummaries?.(groupHeader");
  });
});
