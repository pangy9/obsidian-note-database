/** The search jump already chooses the event's start on a continuous axis. */
export function revealCalendarTimelineSearchResult(target: HTMLElement): void {
  if (!target.closest(".db-timeline.is-continuous")) {
    target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    return;
  }

  // A full event can be much wider than the viewport. Native inline centering
  // would pan away from its start and persist that second, unintended position.
  const win = target.ownerDocument.defaultView;
  if (!win) return;
  const { top, bottom, height } = target.getBoundingClientRect();
  for (let view = target.parentElement; view; view = view.parentElement) {
    if (view.clientHeight >= view.scrollHeight || !/^(auto|scroll|overlay)$/.test(win.getComputedStyle(view).overflowY)) continue;
    const visibleTop = view.getBoundingClientRect().top + view.clientTop;
    if (top < visibleTop || bottom > visibleTop + view.clientHeight) {
      view.scrollTo({ top: view.scrollTop + top - visibleTop - (view.clientHeight - height) / 2, behavior: "smooth" });
    }
    break;
  }
}
