import { addDateKeyDays, MINUTES_PER_DAY } from "./CalendarDateTime";
import type { TimelineScale } from "./types";

export function shiftTimelinePanAnchor(dateKey: string, minutes: number, scale: TimelineScale, units: number): { dateKey: string; minutes: number } {
  if (scale !== "day") return { dateKey: addDateKeyDays(dateKey, units), minutes };
  const total = minutes + units * 60;
  return { dateKey: addDateKeyDays(dateKey, Math.floor(total / MINUTES_PER_DAY)), minutes: ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY };
}

/** Capture the browsed date when changing scale, not the shared navigation anchor.
 * Day windows are rendered from an integral hour plus a fractional scroll offset. */
export function getTimelineScaleAnchor(
  anchor: string, minutes: number, oldScale: TimelineScale, offsetUnits: number,
): { dateKey: string; minutes: number; fraction: number } {
  if (oldScale !== "day") return { dateKey: addDateKeyDays(anchor, Math.floor(offsetUnits)), minutes, fraction: (minutes % 60) / 60 };
  const start = Math.floor(minutes / 60) * 60 + Math.floor(offsetUnits * 60);
  const dateKey = addDateKeyDays(anchor, Math.floor(start / MINUTES_PER_DAY));
  const normalized = ((start % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return { dateKey, minutes: normalized, fraction: (normalized % 60) / 60 };
}

/** Size the buffer from the fractional viewport, not the day grid's whole visible slots.
 * A full column must remain reachable on each side before attempting an integral rebase. */
export function getTimelinePanBufferUnits(viewportUnitSpan: number, nativeTouch = false): number {
  // Leave room for several screen widths of native movement before recentering.
  return Math.max(1, Math.ceil(viewportUnitSpan * (nativeTouch ? 4 : 1)));
}

/** Convert pre-layout browser pixels into a portable date plus a sub-column offset. */
export function normalizeTimelinePanOffset(anchor: string, minutes: number, scale: TimelineScale, offset: number, unitWidth: number): {
  anchor: string; minutes: number; offset: number;
} {
  const units = Math.trunc(offset / unitWidth);
  const shifted = shiftTimelinePanAnchor(anchor, minutes, scale, units);
  return { anchor: shifted.dateKey, minutes: shifted.minutes, offset: offset - units * unitWidth };
}

export function getTimelineJumpVisibility(start: number, end: number, visibleStart: number, visibleEnd: number): {
  before: boolean; after: boolean; overlaps: boolean;
} {
  return { before: start < visibleStart, after: end > visibleEnd, overlaps: start < visibleEnd && end > visibleStart };
}

/** Rebase by whole columns while retaining the exact fractional pixel remainder. */
export function resolveTimelinePanRecenter(left: number, center: number, width: number, viewport: number, content: number): { units: number; remainder: number } | null {
  if (![left, center, width, viewport, content].every(Number.isFinite) || width <= 0 || viewport <= 0) return null;
  if (left > viewport * 0.4 && left < content - viewport * 1.4) return null;
  const units = Math.trunc((left - center) / width);
  return units ? { units, remainder: left - center - units * width } : null;
}

/** Search/title ranges follow the viewport, including partial columns. */
export function getTimelinePanVisibleRange(startDateKey: string, startMinutes: number, scale: TimelineScale, left: number, viewport: number, unitWidth: number): {
  startDateKey: string; endDateKey: string; startMinutes?: number; endMinutes?: number;
} {
  const unit = scale === "day" ? 60 : MINUTES_PER_DAY;
  const offset = scale === "day" ? startMinutes : 0;
  // Do not round up into a timed event outside the visible part of a day.
  const start = offset + left / unitWidth * unit;
  const end = offset + (left + viewport) / unitWidth * unit;
  const startDay = Math.floor(start / MINUTES_PER_DAY);
  const endDay = Math.floor(end / MINUTES_PER_DAY);
  return {
    startDateKey: addDateKeyDays(startDateKey, startDay),
    endDateKey: addDateKeyDays(startDateKey, endDay),
    startMinutes: start - startDay * MINUTES_PER_DAY,
    endMinutes: end - endDay * MINUTES_PER_DAY,
  };
}
