import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { DatabaseConfig, ViewConfig } from "../data/types";
import { normalizeSettingsFolding, persistSettingsFolding, selectedSettingFolds, SETTING_FOLD_GROUPS } from "../data/SettingsFolding";
import { t, setLocale } from "../i18n";
import { createSettingsFoldSection, readSettingsFoldOpen } from "../views/MoreDisplayOptions";
import { ViewConfigPanelRenderer, type ViewConfigPanelActions } from "../views/ViewConfigPanelRenderer";
import { CalendarToolbarRenderer, type CalendarToolbarActions } from "../views/CalendarToolbarRenderer";
import { CalendarTimelineToolbarRenderer, type CalendarTimelineToolbarActions } from "../views/CalendarTimelineToolbarRenderer";
import { ChartToolbarRenderer, type ChartToolbarActions } from "../views/ChartToolbarRenderer";
import { renderSettingsPopoverPreview } from "../views/SettingsFoldingPreview";
import { SettingsFoldingModal } from "../views/modals/SettingsFoldingModal";

vi.mock("obsidian", () => ({
  setIcon() {}, setTooltip() {}, addIcon() {}, Notice: class {}, TFile: class {},
  Component: class {}, FuzzySuggestModal: class {}, SuggestModal: class {},
  Modal: class { setTitle() {} close() {} },
  Setting: class {
    controlEl: MockElement;
    constructor(parent: MockElement) { this.controlEl = parent.createDiv(); }
    setName() { return this; }
  },
}));
vi.mock("../views/modals/ModalDrag", () => ({ makeModalDraggable() {} }));
vi.mock("../views/DateValuePicker", () => ({ closeActiveDateValuePicker() {}, renderDateValuePicker() {} }));
vi.mock("../data/VaultProperties", () => ({ getVaultProperties: () => [] }));
vi.mock("../views/DropdownField", () => ({
  closeDropdownForRoot: () => false,
  createDropdownField: (options: { parent: MockElement; label: string; value: string; onChange: (value: string) => void }) => {
    const button = options.parent.createEl("button", { text: options.label });
    button.value = options.value;
    button.pick = options.onChange;
    return { button };
  },
}));

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
class MockElement {
  readonly children: MockElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly ownerDocument = {};
  readonly attrs: Record<string, string>;
  readonly cls: string;
  open = false;
  value = "";
  checked = false;
  disabled = false;
  scrollTop = 0;
  isConnected = true;
  focused = false;
  textContent: string;
  parent?: MockElement;
  onclick?: () => void;
  onkeydown?: (event: { key: string; preventDefault: () => void }) => void;
  onchange?: () => void;
  ontoggle?: () => void;
  pick?: (value: string) => void;

  constructor(readonly tag: string, opts: Options = {}) {
    this.attrs = { ...opts.attr };
    this.cls = opts.cls ?? "";
    this.textContent = opts.text ?? "";
  }
  get childElementCount() { return this.children.length; }
  get text(): string { return this.textContent + this.children.map(child => child.text).join(""); }
  appendChild(child: MockElement): MockElement { child.remove(); child.parent = this; this.children.push(child); return child; }
  createEl(tag: string, opts?: Options): MockElement { return this.appendChild(new MockElement(tag, opts)); }
  createDiv(opts?: Options) { return this.createEl("div", opts); }
  createSpan(opts?: Options) { return this.createEl("span", opts); }
  empty() { for (const child of [...this.children]) child.remove(); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = undefined; }
  addClass() {}
  hasClass(name: string) { return this.cls.split(/\s+/).includes(name); }
  toggleClass() {}
  addEventListener() {}
  focus() { this.focused = true; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  setAttr(key: string, value: string) { this.setAttribute(key, value); }
  getAttribute(key: string) { return this.attrs[key]; }
  setText(value: string) { this.textContent = value; }
  all(predicate: (node: MockElement) => boolean): MockElement[] {
    return [...(predicate(this) ? [this] : []), ...this.children.flatMap(child => child.all(predicate))];
  }
  querySelectorAll(selector: string) {
    const scope = selector.match(/^details\[data-settings-fold="(.*)"\]$/)?.[1];
    return this.all(el => scope ? el.tag === "details" && el.attrs["data-settings-fold"] === scope
      : selector.startsWith(".") ? el.cls.split(/\s+/).includes(selector.slice(1)) : el.tag === selector);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
}
const html = (node: MockElement) => node as unknown as HTMLElement;
const tab = (node: MockElement, group: string) => node.all(el => el.attrs.role === "tab" && el.attrs.id.endsWith(`-tab-${group}`))[0];
const fold = (node: MockElement, scope: string) => node.querySelector(`details[data-settings-fold="${scope}"]`);
const inputFor = (node: MockElement, label: string) => node.all(el => el.textContent === label)
  .map(el => el.parent?.all(child => child.tag === "input")[0] ?? el.parent?.parent?.parent?.all(child => child.tag === "input")[0]).find(Boolean);
const defaults = (enabled: boolean) => normalizeSettingsFolding({ enabled });
setLocale("en");

describe("settings folding preferences", () => {
  it("starts turned off but retains recommendations for each group", () => {
    expect(defaults(false).enabled).toBe(false);
    expect(selectedSettingFolds(defaults(false)).size).toBe(0);
    expect(defaults(false).items.database).toContain("computedSync");
    expect(defaults(false).items.timeline).not.toContain("timelineContinuous");
    expect(selectedSettingFolds(defaults(true)).has("showEmptyFields")).toBe(true);
  });

  it("keeps explicitly empty groups, discards stale/other group items and deduplicates", () => {
    const value = normalizeSettingsFolding({ enabled: true, items: {
      database: [], view: ["showEmptyFields", "showEmptyFields", "computedSync", "removed"], timeline: 5,
    } });
    expect(value.items.database).toEqual([]);
    expect(value.items.view).toEqual(["showEmptyFields"]);
    expect(value.items.timeline).toEqual(defaults(true).items.timeline);
    expect(normalizeSettingsFolding(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(normalizeSettingsFolding({ ...value, enabled: false }).items).toEqual(value.items);
  });

  it("localizes every choice in all supported languages", () => {
    try {
      for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
        setLocale(locale);
        for (const key of SETTING_FOLD_GROUPS.flatMap(group => [group.label, ...group.items.map(item => item.label)])) {
          expect(t(key), locale + " " + key).not.toBe(key);
        }
      }
    } finally { setLocale("en"); }
  });

  it("writes folding preferences without publishing them early or mutating other settings on failure", async () => {
    const settings = { settingsFolding: defaults(false), databaseFolder: "Notes" };
    const write = vi.fn(async () => {});
    const initial = settings.settingsFolding;
    await expect(persistSettingsFolding(settings, { enabled: false }, write)).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
    const rejected = vi.fn(async () => { throw Error("disk write failed"); });
    await expect(persistSettingsFolding(settings, { enabled: true }, rejected)).rejects.toThrow("disk write failed");
    expect(settings.settingsFolding).toBe(initial);
    const pending = persistSettingsFolding(settings, { enabled: true }, async next => {
      expect(next.settingsFolding.enabled).toBe(true);
      expect(settings.settingsFolding.enabled).toBe(false);
      expect(next.databaseFolder).toBe("Notes");
    });
    await expect(pending).resolves.toBe(true);
    expect(settings.settingsFolding.enabled).toBe(true);
    expect(settings.settingsFolding.items).toEqual(initial.items);
    await persistSettingsFolding(settings, { items: { ...initial.items, database: [] } }, write);
    expect(settings.settingsFolding.enabled).toBe(true);
    expect(settings.settingsFolding.items.database).toEqual([]);
  });

  it("counts selected items and resets only the current group when requested", async () => {
    const initial = normalizeSettingsFolding({ enabled: false, items: { database: [], board: [] } });
    const commit = vi.fn(async () => {});
    const modal = new SettingsFoldingModal({} as App, initial, commit);
    const root = new MockElement("div");
    Object.assign(modal, { contentEl: root, modalEl: new MockElement("div"), containerEl: new MockElement("div") });
    modal.onOpen();
    const count = root.querySelector(".db-settings-folding-count")!;
    const groupReset = root.querySelector(".db-settings-folding-reset-group")!;
    expect(count.textContent).toBe(t("settings.folding.groupCount", { count: 0, total: 7 }));
    const template = inputFor(root, t("template.label"))!;
    template.checked = true; template.onchange?.();
    expect(count.textContent).toBe(t("settings.folding.groupCount", { count: 1, total: 7 }));
    groupReset.onclick?.();
    expect(count.textContent).toBe(t("settings.folding.groupCount", { count: 5, total: 7 }));
    expect(groupReset.disabled).toBe(true);
    const picker = tab(root, "database");
    expect(picker.focused).toBe(true);
    tab(root, "board").onclick?.();
    expect(inputFor(root, t("settings.folding.coverSizing"))?.checked).toBe(false);
    expect(count.textContent).toBe(t("settings.folding.groupCount", { count: 0, total: 3 }));
    expect(commit).not.toHaveBeenCalled();
    root.all(el => el.tag === "button" && el.text === t("common.save"))[0].onclick?.();
    await vi.waitFor(() => expect(commit).toHaveBeenCalledWith({
      enabled: false, items: { ...defaults(false).items, board: [] },
    }));
    modal.onClose();
  });

  it("freezes controls while saving and lets the same draft retry after failure", async () => {
    const initial = defaults(true);
    let fail!: (reason: Error) => void;
    const blocked = new Promise<void>((_resolve, reject) => { fail = reject; });
    const commit = vi.fn<(draft: typeof initial) => Promise<void>>().mockReturnValueOnce(blocked).mockResolvedValue(undefined);
    const modal = new SettingsFoldingModal({} as App, initial, commit);
    const root = new MockElement("div");
    Object.assign(modal, { contentEl: root, modalEl: new MockElement("div"), containerEl: new MockElement("div") });
    modal.onOpen();
    const picker = tab(root, "database");
    const template = inputFor(root, t("template.label"))!;
    template.checked = false; template.onchange?.();
    const reset = root.querySelector(".db-settings-folding-reset-group")!;
    const save = root.all(el => el.tag === "button" && el.text === t("common.save"))[0];
    save.onclick?.();
    expect(save.disabled).toBe(true);
    expect(template.disabled).toBe(true);
    expect(picker.disabled).toBe(true);
    expect(reset.disabled).toBe(true);
    reset.onclick?.();
    expect(inputFor(root, t("template.label"))).toBe(template);
    fail(Error("only this write failed"));
    await vi.waitFor(() => expect(template.disabled).toBe(false));
    expect(template.checked).toBe(false);
    expect(reset.disabled).toBe(false);
    save.onclick?.();
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(commit.mock.calls[1][0]).toEqual(commit.mock.calls[0][0]);
    modal.onClose();
  });

  it("uses the full toolbar panel and real controls for every preview tab", () => {
    const draft = defaults(false);
    const before = JSON.stringify(draft);
    for (const { id } of SETTING_FOLD_GROUPS) {
      const host = new MockElement("div");
      const panel = renderSettingsPopoverPreview(html(host), {} as App, id, draft) as unknown as MockElement;
      const specialized = id === "calendar" || id === "timeline" || id === "chart";
      expect(panel.parent).toBe(host);
      expect(panel.hasClass(specialized ? "db-chart-options-popover" : "db-view-config-panel"), id).toBe(true);
      expect(panel.querySelector(".db-panel-title")?.text, id).toBe(t(specialized ? `${id}.options` : "toolbar.settings"));
      const scope = specialized ? id : id === "database" ? "database" : "view";
      expect(fold(panel, scope)?.children[0].tag, id).toBe("summary");
      expect(panel.querySelectorAll("input").length, id).toBeGreaterThan(0);
    }
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("uses the unsaved draft to move real fields and omits empty disclosures", () => {
    const host = new MockElement("div");
    const empty = normalizeSettingsFolding({ enabled: false, items: Object.fromEntries(SETTING_FOLD_GROUPS.map(({ id }) => [id, []])) });
    renderSettingsPopoverPreview(html(host), {} as App, "gallery", empty);
    expect(fold(host, "view")).toBeNull();
    expect(host.text).toContain(t("viewConfig.coverRatio"));
    empty.items.gallery.push("galleryCoverSizing");
    empty.items.view.push("showEmptyFields");
    renderSettingsPopoverPreview(html(host), {} as App, "gallery", empty);
    expect(fold(host, "view")?.text).toContain(t("viewConfig.coverRatio"));
    expect(fold(host, "view")?.text).toContain(t("viewConfig.showEmptyFields"));
    expect(fold(host, "database")).toBeNull();
  });

  it("uses keyboard tabs and renders only a preview trigger initially", () => {
    const modal = new SettingsFoldingModal({} as App, defaults(false), vi.fn(async () => {}));
    const root = new MockElement("div");
    Object.assign(modal, { contentEl: root, modalEl: new MockElement("div"), containerEl: new MockElement("div") });
    modal.onOpen();
    const database = tab(root, "database");
    expect(database.attrs["aria-selected"]).toBe("true");
    const preventDefault = vi.fn();
    database.onkeydown?.({ key: "ArrowRight", preventDefault });
    const shared = tab(root, "view");
    expect(shared.attrs["aria-selected"]).toBe("true");
    expect(shared.focused).toBe(true);
    expect(database.attrs.tabindex).toBe("-1");
    expect(preventDefault).toHaveBeenCalledOnce();
    const trigger = root.querySelector(".db-settings-folding-preview-trigger");
    expect(trigger?.attrs["aria-expanded"]).toBe("false");
    expect(trigger?.attrs["aria-haspopup"]).toBe("dialog");
    expect(root.querySelector(".db-view-config-panel")).toBeNull();
    expect(fold(root, "view")).toBeNull();
    modal.onClose();
  });

  it("keeps the draft local until saving and resets every group without toggling the feature", async () => {
    const input = normalizeSettingsFolding({ enabled: true, items: { database: [], board: [] } });
    const commit = vi.fn(async () => {});
    const modal = new SettingsFoldingModal({} as App, input, commit);
    const root = new MockElement("div");
    Object.assign(modal, { contentEl: root, modalEl: new MockElement("div"), containerEl: new MockElement("div") });
    modal.onOpen();
    const template = inputFor(root, t("template.label"))!;
    expect(template.checked).toBe(false);
    expect(template.attrs.role).toBe("switch");
    template.checked = true; template.onchange?.();
    expect(input.items.database).toEqual([]);
    tab(root, "board").onclick?.();
    expect(inputFor(root, t("settings.folding.coverSizing"))?.checked).toBe(false);
    root.querySelector(".db-settings-folding-reset")?.onclick?.();
    expect(inputFor(root, t("settings.folding.coverSizing"))?.checked).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    root.all(el => el.tag === "button" && el.text === t("common.save"))[0].onclick?.();
    await vi.waitFor(() => expect(commit).toHaveBeenCalledWith(defaults(true)));
    modal.onClose();
  });
});

describe("folding in database and specialized view popovers", () => {
  const config = (viewType: ViewConfig["viewType"], id = "demo"): ViewConfig => ({
    id, name: "Demo", sourceFolder: "", viewType, schema: { columns: [], computedFields: [] },
  });
  it("keeps plain layout when off and never renders an empty disclosure", () => {
    const panel = new MockElement("div");
    const hidden = createSettingsFoldSection(html(panel), selectedSettingFolds(defaults(false)), "database");
    expect(hidden.target("computedSync")).toBe(panel);
    hidden.finish();
    expect(fold(panel, "database")).toBeNull();
    const nothing = createSettingsFoldSection(html(panel), selectedSettingFolds(defaults(true)), "database");
    nothing.target("computedSync");
    nothing.finish();
    expect(fold(panel, "database")).toBeNull();
  });
  it("creates native keyboard disclosure after normal items and restores its open state", () => {
    const panel = new MockElement("div");
    const reposition = vi.fn();
    const section = createSettingsFoldSection(html(panel), selectedSettingFolds(defaults(true)), "view", true, reposition);
    section.target("recordIcon").createDiv({ text: "folded field" });
    panel.createDiv({ text: "primary field" });
    section.finish();
    const detail = fold(panel, "view")!;
    expect(panel.children.map(node => node.tag)).toEqual(["div", "details"]);
    expect(detail.children[0].tag).toBe("summary");
    expect(readSettingsFoldOpen(html(panel), "view")).toBe(true);
    detail.ontoggle?.();
    expect(reposition).toHaveBeenCalledOnce();
  });
  it("renders computed write-back as text only in the creation-default editor", () => {
    const host = new MockElement("div");
    const renderer = new ViewConfigPanelRenderer();
    const view = config("table");
    const db: DatabaseConfig = {
      id: "db", name: "DB", sourceFolder: "", schema: view.schema, views: [view], computedSyncMode: "manual",
    };
    const actions: ViewConfigPanelActions = { app: {} as App, database: db, onChange: vi.fn() };

    renderer.render(html(host), true, view, { ...actions, creationDefaultsScope: "database" });
    const locked = host.all(el => el.textContent === t("viewConfig.computedSyncMode"))[0].parent!;
    expect(locked.querySelector(".db-view-config-readonly-value")?.text).toBe(t("viewConfig.computedSync.manual"));
    expect(locked.querySelector(".db-computed-sync-cards")).toBeNull();
    expect(locked.querySelector("input")).toBeNull();
    expect(host.all(el => el.dataset.creationDefault === "quickFormEnabled")).toHaveLength(1);

    renderer.render(html(host), true, view, actions);
    const cards = host.querySelector(".db-computed-sync-cards")!;
    expect(cards.all(el => el.tag === "input" && el.attrs.type === "radio")).toHaveLength(3);
  });

  it("keeps gallery title, cover field and size outside and folds fit/ratio together", () => {
    const host = new MockElement("div");
    const renderer = new ViewConfigPanelRenderer();
    const view = config("gallery");
    const db: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "", schema: view.schema, views: [view] };
    const actions: ViewConfigPanelActions = { app: {} as App, database: db, isDatabaseReadOnly: true, onChange: vi.fn(), settingsFolding: defaults(true) };
    renderer.render(html(host), true, view, actions);
    expect(fold(host, "database")?.text).toContain(t("template.label"));
    const foldView = fold(host, "view")!;
    expect(foldView.text).toContain(t("viewConfig.imageFit"));
    expect(foldView.text).toContain(t("viewConfig.coverRatio"));
    expect(foldView.text).not.toContain(t("viewConfig.cardSize"));
    expect(foldView.text).not.toContain(t("viewConfig.titleField"));
    expect(foldView.text).not.toContain(t("viewConfig.coverField"));
    foldView.open = true;
    renderer.render(html(host), true, view, actions);
    expect(fold(host, "view")?.open).toBe(true);
    renderer.render(html(host), true, { ...view, id: "different" }, actions);
    expect(fold(host, "view")?.open).toBe(false);
    renderer.render(html(host), true, view, { ...actions, settingsFolding: defaults(false) });
    expect(fold(host, "database")).toBeNull();
    expect(fold(host, "view")).toBeNull();
    expect(host.text).toContain(t("viewConfig.coverRatio"));
  });
  it("folds only calendar settings applicable to the displayed scale", () => {
    const host = new MockElement("div");
    const renderer = new CalendarToolbarRenderer() as unknown as {
      renderSections(parent: HTMLElement, view: ViewConfig, actions: CalendarToolbarActions): void;
    };
    const actions = { onChange: vi.fn(), getSettingsFolding: () => defaults(true) };
    const view = config("calendar");
    renderer.renderSections(html(host), view, actions);
    const more = fold(host, "calendar")!;
    expect(more.text).toContain(t("calendar.layout"));
    expect(more.text).not.toContain(t("viewConfig.calendarStartHour"));
    expect(more.text).not.toContain(t("viewConfig.eventStartDateField"));
    more.open = true;
    view.calendarScale = "week";
    renderer.renderSections(html(host), view, actions);
    expect(fold(host, "calendar")?.text).toContain(t("viewConfig.calendarStartHour"));
    expect(fold(host, "calendar")?.open).toBe(true);
  });
  it("marks chart appearance defaults on real toolbar controls, not on exports or chart data", () => {
    const host = new MockElement("div");
    const renderer = new ChartToolbarRenderer();
    renderer.renderPreview(html(host), config("chart"), { creationDefaults: true, onChange: vi.fn() });
    const supported = host.all(el => Boolean(el.dataset.creationDefault)).map(el => el.dataset.creationDefault);
    expect(supported).toContain("chartShowTitle");
    expect(supported).toContain("chartGridLines");
    expect(supported).toContain("chartAxisNames");
    expect(supported).not.toContain("chartOmitZeroValues");
    expect(host.all(el => el.tag === "details")).toHaveLength(0);
  });

  it("keeps chart data and title visible while folding optional panel groups and export", () => {
    const host = new MockElement("div");
    const renderer = new ChartToolbarRenderer() as unknown as {
      renderPopoverContent(parent: HTMLElement, container: HTMLElement, view: ViewConfig, actions: ChartToolbarActions): void;
    };
    renderer.renderPopoverContent(html(host), html(host), config("chart"), {
      onChange: vi.fn(), getSettingsFolding: () => defaults(true),
    });
    const more = fold(host, "chart")!;
    expect(more.text).toContain(t("chart.visibleGroups"));
    expect(more.text).toContain(t("chart.exportImage"));
    expect(more.text).not.toContain(t("chart.optionsData"));
    expect(more.text).not.toContain(t("chart.title"));
  });
  it("keeps the continuous-timeline toggle outside by default and alive when changing column sizing", () => {
    const host = new MockElement("div");
    const renderer = new CalendarTimelineToolbarRenderer() as unknown as {
      renderTimelineOptions(parent: HTMLElement, view: ViewConfig, actions: CalendarTimelineToolbarActions): void;
    };
    const change = vi.fn();
    const view = config("timeline");
    renderer.renderTimelineOptions(html(host), view, { onChange: change, getSettingsFolding: () => defaults(false) });
    const continuous = inputFor(host, t("timeline.continuous"))!;
    const size = inputFor(host, t("viewConfig.customColumnWidth"))!;
    expect(continuous).toBeDefined();
    size.checked = true;
    size.onchange?.();
    expect(inputFor(host, t("timeline.continuous"))).toBe(continuous);
    expect(view.timelineColumnSizeMode).toBe("custom");
    continuous.checked = true;
    continuous.onchange?.();
    expect(view.timelineContinuous).toBe(true);
    renderer.renderTimelineOptions(html(host), view, { onChange: change, getSettingsFolding: () => defaults(true) });
    expect(fold(host, "timeline")?.text).toContain(t("viewConfig.customColumnWidth"));
    expect(fold(host, "timeline")?.text).not.toContain(t("timeline.continuous"));
    renderer.renderTimelineOptions(html(host), view, { onChange: change, getSettingsFolding: () =>
      normalizeSettingsFolding({ enabled: true, items: { timeline: ["timelineContinuous"] } }) });
    expect(fold(host, "timeline")?.text).toContain(t("timeline.continuous"));
  });
});
