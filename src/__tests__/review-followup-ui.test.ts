import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { getLocale, setLocale, t } from "../i18n";
const view = (name: string) => readFileSync(new URL(`../views/${name}.ts`, import.meta.url), "utf8");
describe("review follow-up controls", () => {
  it("connects real reminder state and rule IDs to the inbox, independent of prototype navigation", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const inbox = view("modals/RecordReminderInbox");
    expect(main).toContain("new RecordReminderInbox(this.app, this.recordReminderService");
    expect(inbox).toContain("this.service.pending()");
    expect(inbox).toContain("this.openRuleConfig(item.databaseId, item.ruleId, back)");
    expect(inbox).toContain('workspace.on("file-open", cancelIfLeft)');
    expect(inbox).not.toMatch(/PreviewModel|inboxSample/);
  });
  it("uses distinct text for active and paused rule badges in every supported language", () => {
    const original = getLocale();
    try {
      for (const [language, active, paused] of [
        ["en", "Active", "Paused"],
        ["zh-CN", "已启用", "已暂停"],
        ["zh-TW", "已啟用", "已暫停"],
      ] as const) {
        setLocale(language);
        expect(t("reminder.ruleStateActive")).toBe(active);
        expect(t("reminder.ruleStatePaused")).toBe(paused);
      }
    } finally {
      setLocale(original);
    }
  });
  it("uses the reminder footer as an opt-in dropdown boundary", () => {
    expect(view("modals/RecordReminderModal")).toContain("bottomBoundary: this.footer");
    expect(view("DropdownField")).toContain("bottomBoundary: options.bottomBoundary");
    expect(view("PopoverPosition")).toContain("boundary.getBoundingClientRect().top");
  });
  it("keeps distinct reminder trigger and due times, and specific validation labels", () => {
    const src = view("modals/RecordReminderModal");
    const inbox = view("modals/RecordReminderInbox");
    expect(inbox).toContain('formatter.format(item.reminderAt)');
    expect(inbox).toContain('formatter.format(item.dueAt)');
    expect(src).toContain('"reminder.noCompletionOptions"');
    expect(src).toContain('"reminder.invalidDateOnlyTime"');
    expect(src.match(/defaultCompletedValues\(/g)).toHaveLength(3);
  });
});


describe("live rule window and desktop return wiring", () => {
  it("uses the real rule modal for the toolbar, including a dev build", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const toolbar = main.slice(main.indexOf("  getReminderConfigurationAction("), main.indexOf("  private getReminderRecordIcons("));
    expect(toolbar).toContain("this.configureRecordReminders(database.id");
    expect(toolbar).not.toMatch(/reminderPrototype|REMINDER_PREVIEW/);
    const editor = view("modals/RecordReminderModal");
    expect(editor).toContain("this.source.getRecordsForDatabase(db)");
    expect(editor).toContain("getRecordReminderRulePreview(previewRule, db, this.records, now)");
    expect(editor).toContain("this.save(draft, latest)");
    expect(main).toContain("(draft, expected) => this.enqueueSettingsWrite(() => persistRecordReminderRules(settings, databaseId, draft,");
  });
  it("hooks only the explicit card button, and leaves native mobile opening alone", () => {
    expect(view("RecordDetailPanel")).toContain("actions.openNoteFromCard(r, anchorEl)");
    expect(view("BoardRenderer")).toContain("this.actions.openNoteFromCard(row, card)");
    const nav = view("DatabaseNoteReturn");
    expect(nav).toContain("Platform.isMobile");
    expect(nav).toContain("isVisible(origin.view.containerEl)");
    expect(nav).toContain('workspace.getLeaf("tab")');
    expect(nav).not.toMatch(/setTimeout|setInterval/);
  });
});

describe("shared focus styles for plugin text editors", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const rule = css.match(/\/\* Shared text-entry focus[^*]*\*\/\s*([^{}]+)\{([^{}]+)\}/);
  it("removes theme rings only on text-entry controls in plugin views, modals, settings and portals", () => {
    expect(rule).not.toBeNull();
    const [, selector, declarations] = rule!;
    expect(selector).toMatch(/\.note-database-container[\s\S]+\.note-database-modal[\s\S]+\.note-database-settings/);
    expect(selector).toContain(".db-dropdown-popover");
    expect(selector).toContain(".db-relation-popover");
    expect(selector).toContain("textarea");
    expect(selector).toContain('[type="search"]');
    expect(selector).not.toMatch(/\b(button|select|checkbox|radio|range|body)\b/);
    expect(declarations).toContain("outline: none !important");
    expect(declarations).toContain("box-shadow: none !important");
    expect(declarations).toContain("var(--background-modifier-hover)");
    expect(declarations).not.toMatch(/(?:^|\n)\s*border(?:-color)?:/);
  });
  it("keeps field validation, including the date-only group's red border", () => {
    expect(css).toMatch(/\.db-rr-date-time\.is-invalid\s*\{\s*border-color: var\(--text-error\);/);
    expect(css).toMatch(/\.db-form-has-error \.db-form-textarea[\s\S]*?\{\s*border-color: var\(--text-error\);/);
    expect(css).toContain(".db-button-composition-surface:has(.db-button-composition-text:focus)");
    expect(css).not.toContain(".db-button-composition-surface:focus-within { outline");
  });
});

describe("plugin-wide control focus", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const match = css.match(/\/\* Shared control focus[\s\S]*?\*\/([\s\S]+?)\/\* Shared text-entry focus/);
  it("replaces keyboard focus perimeters with an inset tint across plugin-owned surfaces", () => {
    const shared = match?.[1] ?? "";
    expect(shared).toContain("outline: none !important");
    expect(shared).toContain("box-shadow: inset");
    expect(shared).toContain(":focus-visible");
    for (const scope of [".note-database-container", ".note-database-modal", ".note-database-settings", ".db-icon-picker-popover", ".db-relation-popover", ".db-return-to-view"]) {
      expect(shared).toContain(scope);
    }
    expect(css).not.toMatch(/\.db-rr-content button:focus-visible|\.db-button-modal button:focus-visible/);
    const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g));
    expect(rules.filter(([, selector, body]) => /:focus/.test(selector) && /outline:\s*(?:[1-9]|solid)/.test(body))).toEqual([]);
  });
  it("keeps selection, cut, and drag feedback distinct from focus", () => {
    expect(css).toContain(".db-icon-color.is-active, .db-cell-cut-source");
    expect(css).toMatch(/\.db-cell-cut-source\s*\{\s*outline: 2px dashed/);
    expect(css).toMatch(/\.db-icon-color\.is-active\s*\{\s*outline: 2px solid/);
    expect(css).toMatch(/\.db-cell-focus\s*\{[^}]*--db-cell-selection-tint: 30%;[^}]*\}/);
    expect(css).toContain("var(--db-control-state-shadow, 0 0 0 0 transparent)");
    expect(css).toMatch(/\.db-displayopt-swatch\.is-selected\s*\{\s*--db-control-state-shadow:/);
  });
});

it("re-reads the reminder preview on note return", () => {
  const editor = view("modals/RecordReminderModal");
  expect(editor).toMatch(/this\.records = undefined;\s*this\.refreshPreviews\(\);\s*this\.details\?\.resume\(\)/);
  expect(view("modals/LiveReminderRuleDetails")).toMatch(/refresh\(\): void \{\s*const next = this\.readResult\(\)/);
});

it("keeps keyboard focus discernible with system colors and no perimeter in high contrast", () => {
  const forcedColors = readFileSync(new URL("../../styles.css", import.meta.url), "utf8")
    .split("@media (forced-colors: active)")[1]?.split("@media (prefers-reduced-motion: reduce)")[0];
  expect(forcedColors).toContain(":focus-visible");
  expect(forcedColors).toContain("background-color: Highlight");
  expect(forcedColors).toContain("color: HighlightText");
  expect(forcedColors).not.toContain("outline:");
});


describe("command palette labels", () => {
  it("uses localized action labels without repeating the plugin name and updates all registrations on language change", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const names = main.slice(main.indexOf("private readonly commandNameKeys"), main.indexOf("  async onload("));
    const commands = Array.from(main.matchAll(/this\.addCommand\(\{\s*id: "([^"]+)",\s*name: t\("([^"]+)"\)/g));
    expect(commands).toHaveLength(9);
    expect(main).toContain('command.name = `${this.manifest.name}: ${t(key)}`');
    const original = getLocale();
    try {
      for (const lang of ["en", "zh-CN", "zh-TW"] as const) {
        setLocale(lang);
        for (const [, id, key] of commands) {
          expect(names).toContain(`"${id}": "${key}"`);
          expect(t(key)).not.toBe(key);
          expect(t(key)).not.toMatch(/^\s*(?:Note database|笔记数据库|筆記資料庫)\s*[:：]/i);
        }
      }
      setLocale("zh-CN");
      expect(t("command.openQuickForm")).toBe("打开快速采集表单");
      expect(t("command.openDashboard")).toBe("打开面板");
    } finally {
      setLocale(original);
    }
  });

  it("keeps live reminders and leaves out the development-only reminder prototype", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const build = readFileSync(new URL("../../esbuild.config.mjs", import.meta.url), "utf8");
    expect(main).toContain('id: "show-record-reminders"');
    expect(main).toContain('id: "configure-record-reminders"');
    expect(main).not.toMatch(/review-reminder-inbox|RecordReminderPrototype|__NOTE_DATABASE_REMINDER_PREVIEW__/);
    expect(build).not.toContain("--reminder-preview");
    expect(existsSync(new URL("../views/prototypes/RecordReminderPrototype.ts", import.meta.url))).toBe(false);
  });
});
