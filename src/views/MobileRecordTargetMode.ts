import { setIcon } from "obsidian";
import { t } from "../i18n";

const ROW_SELECTOR = [
  "tr[data-note-database-row-path]",
  ".db-list-row[data-note-database-row-path]",
  ".db-gallery-card[data-note-database-row-path]",
  ".db-board-card[data-note-database-row-path]",
  ".db-timeline-event[data-note-database-row-path]",
].join(", ");

type Placement = "before" | "after";

/** Explicit tap-target mode; a neutral, sticky bar survives scrolling across groups. */
export function startMobileRecordTargetMode(options: {
  root: HTMLElement;
  bannerHost: HTMLElement;
  movedPath: string;
  eligiblePaths: ReadonlySet<string>;
  labelForPath(path: string): string;
  onPlace(targetPath: string, placement: Placement): void;
}): () => void {
  const { root, bannerHost, movedPath, eligiblePaths } = options;
  const doc = root.ownerDocument;
  const banner = bannerHost.createDiv({ cls: "db-mobile-target-banner" });
  const icon = banner.createSpan({ cls: "db-mobile-target-banner-icon" });
  setIcon(icon, "arrow-up-down");
  const copy = banner.createDiv({ cls: "db-mobile-target-copy" });
  copy.createDiv({ cls: "db-mobile-target-title", text: t("mobile.movingRecord", { name: options.labelForPath(movedPath) }) });
  const hint = copy.createDiv({ cls: "db-mobile-target-hint", text: t("mobile.chooseTargetHint") });
  const actions = banner.createDiv({ cls: "db-mobile-target-actions" });
  bannerHost.prepend(banner);
  root.addClass("is-mobile-target-mode");

  // The database scrolls horizontally as one surface (notably on board/table).
  // Sticky only pins the banner vertically; compensate its horizontal scroll so
  // the banner stays in the visible viewport while the target rows move below it.
  const scrollHost = bannerHost.closest<HTMLElement>(".note-database-container") || bannerHost;
  const syncHorizontalPosition = (): void => {
    banner.style.transform = scrollHost.scrollLeft ? `translateX(${scrollHost.scrollLeft}px)` : "";
  };
  scrollHost.addEventListener("scroll", syncHorizontalPosition, { passive: true });
  syncHorizontalPosition();

  let active = true;
  let selected: HTMLElement | undefined;
  const observer = new MutationObserver(() => {
    if (!root.isConnected || !bannerHost.isConnected) cleanup();
  });
  const cleanup = (): void => {
    if (!active) return;
    active = false;
    root.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKeydown, true);
    scrollHost.removeEventListener("scroll", syncHorizontalPosition);
    observer.disconnect();
    root.removeClass("is-mobile-target-mode");
    selected?.removeClass("is-mobile-target-selected");
    banner.remove();
  };
  const commit = (path: string, placement: Placement): void => {
    cleanup();
    options.onPlace(path, placement);
  };
  const addCancel = (): void => {
    const cancel = actions.createEl("button", { cls: "db-mobile-target-cancel", text: t("common.cancel"), attr: { type: "button" } });
    cancel.onclick = (event) => { event.preventDefault(); event.stopPropagation(); cleanup(); };
  };
  const selectTarget = (item: HTMLElement, path: string): void => {
    selected?.removeClass("is-mobile-target-selected");
    selected = item;
    item.addClass("is-mobile-target-selected");
    hint.setText(t("mobile.targetSelected", { name: options.labelForPath(path) }));
    actions.empty();
    actions.createEl("button", { cls: "db-mobile-target-commit", text: t("mobile.insertBefore"), attr: { type: "button" } })
      .onclick = (event) => { event.preventDefault(); event.stopPropagation(); commit(path, "before"); };
    actions.createEl("button", { cls: "db-mobile-target-commit", text: t("mobile.insertAfter"), attr: { type: "button" } })
      .onclick = (event) => { event.preventDefault(); event.stopPropagation(); commit(path, "after"); };
    addCancel();
  };
  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest<HTMLElement>(ROW_SELECTOR);
    if (!item || !root.contains(item)) return;
    const path = item.getAttribute("data-note-database-row-path") || "";
    if (!eligiblePaths.has(path)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (path !== movedPath) selectTarget(item, path);
  };
  const onKeydown = (event: KeyboardEvent): void => { if (event.key === "Escape") cleanup(); };

  addCancel();
  root.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKeydown, true);
  observer.observe(doc.body, { childList: true, subtree: true });
  return cleanup;
}
