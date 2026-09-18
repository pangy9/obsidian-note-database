import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 回归锁（issue #8）：条件格式与 Style → Event color 对 Timeline all-day 条（date 列
// 事件）不可见。注入端 inline 设置 --db-calendar-event-bg/-accent（条件格式与事件色
// 两条路径都设），但 .is-all-day 规则硬编码 hover 渐变与 text-faint 边框，不消费变量。
// 修复：all-day 渐变/边框与 timed 版本同构地消费 var(--db-calendar-event-bg/-accent)，
// 兜底值即原默认外观，无颜色时零变化；被裁剪事件的 ::before/::after 渐隐边缘复用
// --db-timeline-event-background-image，覆盖自定义属性即自动跟随。

const read = (rel: string): string =>
  readFileSync(join(__dirname, rel), "utf8");

describe("Timeline all-day 事件色（条件格式 + Event color）", () => {
  const css = read("../../styles.css");

  it(".is-all-day 渐变两处规则块均消费 --db-calendar-event-bg，兜底保持 hover 默认外观", () => {
    // styles.css 有两处并行的 timeline 规则块（shared base 与完整布局），各有一份
    // .is-all-day 渐变覆盖，都必须消费事件色变量。
    const blocks = css.match(/\.db-timeline-event\.is-all-day \{[^}]*\}/g) ?? [];
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block).toContain("linear-gradient(var(--db-calendar-event-bg,");
      expect(block).toContain(
        "color-mix(in srgb, var(--background-modifier-hover) 70%, transparent)"
      );
    }
  });

  it(".is-all-day 边框消费 --db-calendar-event-accent，兜底 text-faint 不变", () => {
    expect(css).toContain(
      "border-left: 2px solid var(--db-calendar-event-accent, var(--text-faint))"
    );
    // 硬编码边框是 issue #8 的压制源之一，不允许回归。
    expect(css).not.toContain("border-left: 2px solid var(--text-faint)");
  });

  it("清理 all-day 内联 accent 声明（死代码，且会吃掉无颜色时的 fallback）", () => {
    // 旧规则在块内声明 --db-calendar-event-accent: var(--text-muted)，使 border-left
    // 的 text-faint 兜底永不生效（自定义属性声明总在 fallback 之前命中）。
    expect(css).not.toContain("--db-calendar-event-accent: var(--text-muted)");
  });

  it("注入端：条件格式与事件色两条路径都 inline 设置事件色变量", () => {
    // 条件格式（applyConditionalFormat）与 Timeline Event color
    // （applyCalendarEventColor）都注入 --db-calendar-event-bg，CSS 侧消费它们即可
    // 同时修复两条路径。
    const formatting = read("../data/ConditionalFormatting.ts");
    expect(formatting).toContain('setProperty("--db-calendar-event-bg"');
    const timeline = read("../views/CalendarTimelineRenderer.ts");
    expect(timeline).toMatch(
      /applyCalendarEventColor\(button: HTMLElement[\s\S]*?setProperty\("--db-calendar-event-bg"/
    );
  });

  it("date 列事件挂 is-all-day 且经过条件格式（渲染路径未被裁剪）", () => {
    const timeline = read("../views/CalendarTimelineRenderer.ts");
    expect(timeline).toMatch(/isDateColumn \? " is-all-day" : ""/);
    expect(timeline).toContain("this.actions.applyConditionalFormat?.(button, event.row, config)");
  });
});
