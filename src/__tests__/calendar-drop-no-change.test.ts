import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Bug 3：日历/时间线事件拖回同一天（日期未变）时，updateCalendarTimelineDates 在
// cellChanges.length === 0 分支静默 return，用户没有任何反馈。修复后该分支应弹 Notice。
// 这是 UI 副作用（Notice），项目无 jsdom 无法实例化渲染器，故用 source-level contract
// 锁定「分支调用了 Notice + 三语言文案齐全」。

describe("calendar drag-to-same-day feedback", () => {
  it("shows a notice when a calendar/timeline drag changes nothing", () => {
    const view = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    // 空变更分支必须从单行 return 改为块语句，并在其中弹 Notice。
    expect(view).toContain("if (cellChanges.length === 0) {");
    expect(view).toContain('new Notice(t("calendar.noDateChange"))');
  });

  it("ships calendar.noDateChange copy in all three languages", () => {
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");
    expect(i18n).toContain('"calendar.noDateChange": "Date unchanged"');
    expect(i18n).toContain('"calendar.noDateChange": "日期未变更"');
    expect(i18n).toContain('"calendar.noDateChange": "日期未變更"');
  });
});
