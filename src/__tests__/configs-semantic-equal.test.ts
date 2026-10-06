import { describe, expect, it } from "vitest";
import { configsDeepEqual, configsSemanticEqual } from "../data/FrontmatterPatch";

/**
 * rebuildViewEntries 的身份保持依赖 configsSemanticEqual 判定「重解析产物与
 * 内存旧对象是否同配置」：自身保存的回声（保存 → 文件事件 → rebuild）必须
 * 判等以沿用旧对象，否则常驻弹层闭包失效（日历/时间线「调一次后失灵」）。
 */
describe("configsSemanticEqual", () => {
  it("treats undefined-valued keys as absent (live mutation vs parsed omission)", () => {
    // 关闭自定义列宽时内存里显式赋 undefined；磁盘解析产物直接省略该键。
    const live = { viewType: "calendar", calendarColumnSizeMode: "custom", calendarCustomColumnWidth: undefined };
    const parsed = { viewType: "calendar", calendarColumnSizeMode: "custom" };
    expect(configsSemanticEqual(live, parsed)).toBe(true);
    expect(configsDeepEqual(live, parsed)).toBe(false); // 基础版会误判——这正是需要语义版的原因
  });

  it("detects real value differences", () => {
    const a = { viewType: "calendar", calendarCustomColumnWidth: 200 };
    const b = { viewType: "calendar", calendarCustomColumnWidth: 320 };
    expect(configsSemanticEqual(a, b)).toBe(false);
  });

  it("ignores key order and handles nested undefined keys in arrays/objects", () => {
    const a = { views: [{ id: "1", sortRules: undefined, name: "v1" }], name: "db" };
    const b = { name: "db", views: [{ name: "v1", id: "1" }] };
    expect(configsSemanticEqual(a, b)).toBe(true);
    expect(configsSemanticEqual({ views: [{ id: "1" }, { id: "2" }] }, { views: [{ id: "2" }, { id: "1" }] })).toBe(false);
  });

  it("keeps null/NaN semantics from configsDeepEqual", () => {
    expect(configsSemanticEqual(null, null)).toBe(true);
    expect(configsSemanticEqual(null, undefined)).toBe(false);
    expect(configsSemanticEqual({ v: NaN }, { v: NaN })).toBe(true);
    expect(configsSemanticEqual({ v: 0 }, { v: null })).toBe(false);
  });
});
