import { expect, it, vi } from "vitest";
import { revealCalendarTimelineSearchResult } from "../views/CalendarTimelineSearchReveal";

it("scrolls vertically without moving the pinned calendar search date on a continuous timeline", () => {
  const view = {
    scrollHeight: 950, clientHeight: 300, clientTop: 1, scrollTop: 50,
    getBoundingClientRect: () => ({ top: 60 }), scrollTo: vi.fn(),
  };
  const target = {
    parentElement: view,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ overflowY: "auto" }) } },
    getBoundingClientRect: () => ({ top: 450, bottom: 490, height: 40 }),
    closest: () => ({}), scrollIntoView: vi.fn(),
  };
  revealCalendarTimelineSearchResult(target as unknown as HTMLElement);
  expect(target.scrollIntoView).not.toHaveBeenCalled();
  expect(view.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 309, behavior: "smooth" });
});
