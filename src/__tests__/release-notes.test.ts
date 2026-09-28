import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RELEASE_NOTES,
  buildChangelogMarkdown,
  collectChangelogNotes,
  compareVersions,
} from "../data/ReleaseNotes";

// 更新日志弹窗的区间逻辑（旧版本 → 新版本全量展示）：文案数据 + 纯函数直测，
// main.ts 接线用源码断言锁定（modal-drag 模式）。

describe("compareVersions", () => {
  it("semver 升序/降序/相等", () => {
    expect(compareVersions("1.2.9", "1.3.0")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("collectChangelogNotes", () => {
  it("区间 (from, to]：新 → 旧排列，只含区间内已收录版本", () => {
    const notes = collectChangelogNotes("1.2.5", "1.3.0", "en");
    // 1.2.5 排除（已读过），1.2.6/1.2.8/1.2.9/1.3.0 收录且新→旧。
    expect(notes.length).toBe(4);
    expect(notes[0]).toContain("1.3.0");
    expect(notes[notes.length - 1]).toContain("1.2.6");
    expect(notes.some((note) => note.includes("1.2.5"))).toBe(false);
  });

  it("相邻版本只弹单条；zh-CN/zh-TW 取对应语言", () => {
    expect(collectChangelogNotes("1.2.9", "1.3.0", "en")).toHaveLength(1);
    expect(collectChangelogNotes("1.2.9", "1.3.0", "zh-CN")[0]).toContain("更新内容");
    expect(collectChangelogNotes("1.2.9", "1.3.0", "zh-TW")[0]).toContain("更新內容");
  });

  it("from 为空（首次安装无记录）：只弹当前版本；from 极旧：收录全部（需求场景）", () => {
    expect(collectChangelogNotes(undefined, "1.3.1", "en")).toHaveLength(1);
    expect(collectChangelogNotes("", "1.3.1", "en")).toHaveLength(1);
    // 从 1.0.0 一路升上来：期间所有已收录版本全部展示。
    expect(collectChangelogNotes("1.0.0", "1.3.1", "en")).toHaveLength(RELEASE_NOTES.length);
  });

  it("to 尚无文案（开发版）：回落 <= to 的最近一条，保持弹窗总有内容", () => {
    const notes = collectChangelogNotes("1.3.1", "1.3.2", "en");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("1.3.1");
  });

  it("system locale 回落 en；三语言文案齐备且数据按版本倒序", () => {
    expect(collectChangelogNotes("1.2.9", "1.3.0", "system")[0]).toContain("What");
    for (let index = 0; index < RELEASE_NOTES.length; index += 1) {
      const entry = RELEASE_NOTES[index];
      expect(entry.notes.en).toContain("##");
      expect(entry.notes["zh-CN"]).toContain("##");
      expect(entry.notes["zh-TW"]).toContain("##");
      if (index > 0) {
        expect(compareVersions(entry.version, RELEASE_NOTES[index - 1].version)).toBe(-1);
      }
    }
    expect(RELEASE_NOTES.some((entry) => entry.version === "1.3.0")).toBe(true);
  });

  it("文案为真实换行（防止数据生成时双重转义成字面 \\n）", () => {
    for (const entry of RELEASE_NOTES) {
      for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
        const note = entry.notes[locale];
        expect(note).toContain("\n");
        expect(note).not.toContain("\\n");
        expect(note).not.toMatch(/\\n/);
      }
    }
  });
});

describe("buildChangelogMarkdown", () => {
  it("多版本用分隔线拼接；单版本即原文", () => {
    const markdown = buildChangelogMarkdown("1.2.5", "1.3.0", "en");
    expect(markdown).toContain("\n\n---\n\n");
    expect(markdown.indexOf("1.3.0")).toBeLessThan(markdown.indexOf("1.2.6"));
    expect(buildChangelogMarkdown("1.2.9", "1.3.0", "en")).not.toContain("---");
  });
});

describe("main.ts 接线（源码断言）", () => {
  it("捕获旧版本在落盘之前；渲染区间文案；i18n 单版本键已迁移删除", () => {
    const main = readFileSync(join(__dirname, "..", "main.ts"), "utf8");
    expect(main).toContain("const previousVersion = this.settings.lastChangelogVersion || undefined;");
    expect(main).toContain("buildChangelogMarkdown(previousVersion, this.manifest.version, getLocale())");
    const capture = main.indexOf("const previousVersion =");
    const write = main.indexOf("this.settings.lastChangelogVersion = this.manifest.version;");
    expect(capture).toBeLessThan(write);
    expect(main).not.toContain('t("changelog.releaseNotes")');
    const i18n = readFileSync(join(__dirname, "..", "i18n.ts"), "utf8");
    expect(i18n).not.toContain('"changelog.releaseNotes"');
    expect(i18n).toContain('"changelog.viewPluginPage"');
  });
});
