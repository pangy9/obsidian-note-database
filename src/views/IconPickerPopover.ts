import { Notice, setIcon, setTooltip } from "obsidian";
import { EMOJI_CATEGORIES, getLucideCategoryIds, LUCIDE_CATEGORY_DEFINITIONS } from "../data/IconPickerCatalog";
import { RECORD_ICON_COLORS, RecordIconColor, serializeLucideIconToken } from "../data/RecordIcon";
import { t } from "../i18n";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { positionToolbarPopover } from "./PopoverPosition";
import { getValidRecordIconIds } from "./RecordIconRenderer";

export interface IconPickerOptions {
  anchor: HTMLElement;
  current?: string;
  recent?: string[];
  onRecentChange?(recent: string[]): void | Promise<void>;
  onSelect(value: string | null): void | Promise<void>;
}

const EMOJI_CATEGORY_ICONS: Record<string, string> = {
  people: "smile", nature: "leaf", food: "carrot", activities: "trophy",
  travel: "plane", objects: "lightbulb", symbols: "badge-check", flags: "flag",
};

export function openIconPickerPopover(options: IconPickerOptions): () => void {
  const doc = window.activeDocument;
  doc.querySelectorAll(".db-icon-picker-popover").forEach((element) => element.remove());
  const panel = doc.body.createDiv({ cls: "db-icon-picker-popover" });
  let tab: "emoji" | "lucide" = options.current?.startsWith("lucide:") ? "lucide" : "emoji";
  let category = tab === "emoji" ? "people" : "common";
  let color: RecordIconColor = (options.current?.match(/^lucide:[^@]+@([a-z]+)$/)?.[1] as RecordIconColor) || "gray";
  let current = options.current ?? null;
  let closed = false;

  let removeAutoClose: (() => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    removeAutoClose?.();
    panel.remove();
    doc.removeEventListener("mousedown", onOutside, true);
    doc.removeEventListener("keydown", onKeydown, true);
  };
  const commit = async (value: string | null) => {
    try {
      await options.onSelect(value);
      current = value;
      if (value) await options.onRecentChange?.([value, ...(options.recent || []).filter((item) => item !== value)].slice(0, 16));
      render(true);
    } catch (error) {
      new Notice(t("errors.updateFailed", { error: String(error) }));
    }
  };

  const render = (preserveScroll = false) => {
    const previousScrollTop = preserveScroll
      ? panel.querySelector<HTMLElement>(".db-icon-picker-scroll")?.scrollTop || 0
      : 0;
    panel.empty();
    const header = panel.createDiv({ cls: "db-icon-picker-header" });
    const tabs = header.createDiv({ cls: "db-icon-picker-tabs" });
    const createTab = (kind: "emoji" | "lucide", label: string) => {
      const button = tabs.createEl("button", { text: label, cls: tab === kind ? "is-active" : "", attr: { type: "button" } });
      button.onclick = () => { tab = kind; category = kind === "emoji" ? "people" : "common"; render(); };
    };
    createTab("emoji", t("recordIcon.emoji"));
    createTab("lucide", t("recordIcon.icons"));
    const remove = header.createEl("button", { text: t("recordIcon.remove"), cls: "db-icon-picker-remove", attr: { type: "button" } });
    remove.onclick = () => { void commit(null); };
    const random = header.createEl("button", { cls: "db-icon-picker-random", attr: { type: "button", title: t("recordIcon.random"), "aria-label": t("recordIcon.random") } });
    setIcon(random, "shuffle");

    if (tab === "lucide") {
      const colors = panel.createDiv({ cls: "db-icon-picker-colors" });
      for (const candidate of RECORD_ICON_COLORS) {
        const dot = colors.createEl("button", {
          cls: `db-icon-color db-icon-color-${candidate}${candidate === color ? " is-active" : ""}`,
          attr: { type: "button", title: candidate, "aria-label": candidate },
        });
        dot.onclick = () => { color = candidate; render(true); };
      }
    }

    const computeValues = () => {
      const recentValues = (options.recent || []).filter((value) => tab === "lucide" ? value.startsWith("lucide:") : !value.startsWith("lucide:"));
      const allLucide = getValidRecordIconIds();
      let values: string[];
      let sectionLabel: string;
      if (tab === "emoji") {
        const selectedCategory = EMOJI_CATEGORIES.find((item) => item.id === category) || EMOJI_CATEGORIES[0];
        values = category === "recent" ? recentValues : selectedCategory.items.map((item) => item.value);
        sectionLabel = category === "recent" ? t("recordIcon.recent") : t(selectedCategory.labelKey);
      } else {
        const known = new Set(LUCIDE_CATEGORY_DEFINITIONS.flatMap((item) => getLucideCategoryIds(item.id, allLucide)));
        const source = category === "other" ? allLucide.filter((id) => !known.has(id)) : getLucideCategoryIds(category, allLucide);
        values = category === "recent" ? recentValues : source;
        const definition = LUCIDE_CATEGORY_DEFINITIONS.find((item) => item.id === category);
        sectionLabel = category === "recent" ? t("recordIcon.recent") : definition ? t(definition.labelKey) : t("recordIcon.category.other");
      }
      return { recentValues, values, sectionLabel };
    };
    const renderGrid = (scroller: HTMLElement) => {
      const { recentValues, values, sectionLabel } = computeValues();
      const renderToken = (target: HTMLElement, value: string) => {
        const selected = value === current || (value.startsWith("lucide:") && value.replace(/@[^@]+$/, "") === current?.replace(/@[^@]+$/, ""));
        const button = target.createEl("button", { cls: `db-icon-picker-item${selected ? " is-selected" : ""}`, attr: { type: "button", title: value } });
        if (value.startsWith("lucide:")) {
          const match = value.match(/^lucide:([^@]+)(?:@(.+))?$/);
          if (match) { setIcon(button, match[1]); button.addClass(`db-record-icon-color-${match[2] || "gray"}`); }
        } else button.createSpan({ text: value });
        button.onclick = () => { void commit(value); };
      };
      if (category !== "recent" && recentValues.length) {
        const recent = scroller.createDiv({ cls: "db-icon-picker-section" });
        recent.createDiv({ cls: "db-icon-picker-label", text: t("recordIcon.recent") });
        const grid = recent.createDiv({ cls: "db-icon-picker-grid" });
        recentValues.forEach((value) => {
          const lucideId = value.startsWith("lucide:") ? value.match(/^lucide:([^@]+)/)?.[1] : null;
          renderToken(grid, tab === "lucide" && lucideId ? serializeLucideIconToken(lucideId, color) : value);
        });
      }
      const section = scroller.createDiv({ cls: "db-icon-picker-section" });
      section.createDiv({ cls: "db-icon-picker-label", text: sectionLabel });
      const grid = section.createDiv({ cls: "db-icon-picker-grid" });
      values.slice(0, 240).forEach((value) => {
        if (tab === "emoji") { renderToken(grid, value); return; }
        const lucideId = value.startsWith("lucide:") ? value.match(/^lucide:([^@]+)/)?.[1] : value;
        renderToken(grid, lucideId ? serializeLucideIconToken(lucideId, color) : value);
      });
      if (!values.length) grid.createDiv({ cls: "db-icon-picker-empty", text: t("common.noResults") });
    };
    const scroller = panel.createDiv({ cls: "db-icon-picker-scroll" });
    renderGrid(scroller);

    const nav = panel.createDiv({ cls: "db-icon-picker-nav" });
    const navItems = tab === "emoji"
      ? [{ id: "recent", label: t("recordIcon.recent"), icon: "clock-3" }, ...EMOJI_CATEGORIES.map((item) => ({ id: item.id, label: t(item.labelKey), icon: EMOJI_CATEGORY_ICONS[item.id] || "circle" }))]
      : [{ id: "recent", label: t("recordIcon.recent"), icon: "clock-3" }, ...LUCIDE_CATEGORY_DEFINITIONS.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })), { id: "other", label: t("recordIcon.category.other"), icon: "ellipsis" }];
    for (const item of navItems) {
      const button = nav.createEl("button", { cls: category === item.id ? "is-active" : "", attr: { type: "button", title: item.label, "aria-label": item.label } });
      setIcon(button, item.icon);
      setTooltip(button, item.label, { delay: 150 });
      button.onclick = () => { category = item.id; render(); panel.querySelector<HTMLElement>(".db-icon-picker-scroll")?.scrollTo(0, 0); };
    }

    random.onclick = () => {
      const { values } = computeValues();
      const value = values[Math.floor(Math.random() * values.length)];
      if (value) void commit(tab === "emoji" || category === "recent" ? value : serializeLucideIconToken(value, color));
    };
    positionToolbarPopover(panel, options.anchor, { preferredWidth: 318, maxWidth: 318, minWidth: 318, gap: 8 });
    if (preserveScroll) scroller.scrollTop = previousScrollTop;
  };

  const onOutside = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || options.anchor.contains(target))) return;
    close();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const items = Array.from(panel.querySelectorAll<HTMLButtonElement>(".db-icon-picker-item"));
    if (!items.length) return;
    const current = doc.activeElement instanceof HTMLButtonElement ? items.indexOf(doc.activeElement) : -1;
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -8 : 8;
    event.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, current < 0 ? 0 : current + delta))]?.focus();
  };
  render();
  window.setTimeout(() => doc.addEventListener("mousedown", onOutside, true), 0);
  doc.addEventListener("keydown", onKeydown, true);
  removeAutoClose = installPopoverAutoClose({ panel, anchorEl: options.anchor, close });
  return close;
}
