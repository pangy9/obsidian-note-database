/** Pure display logic for number rating/progress styles. No DOM/Obsidian deps — unit-testable. */

export const RATING_MAX_STARS = 5;

export type RatingSlot = "full" | "half" | "empty";

/** Round to the nearest half (0.5 step): 3.2→3, 3.5→3.5, 3.7→3.5, 3.8→4. */
export function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Build the rating slots (full/half/empty) for a value, `max` stars. Non-finite → empty array. */
export function buildRatingSlots(value: number, max: number = RATING_MAX_STARS): RatingSlot[] {
  if (!Number.isFinite(value) || max <= 0) return [];
  const rounded = clampNumber(roundHalf(value), 0, max);
  const slots: RatingSlot[] = [];
  for (let i = 1; i <= max; i++) {
    if (rounded >= i) slots.push("full");
    else if (rounded >= i - 0.5) slots.push("half");
    else slots.push("empty");
  }
  return slots;
}

/** Progress fill percentage as value/divisor*100, clamped to [0, 100].
 *  divisor = the value that represents 100% (default 100 → value is already a percent).
 *  Non-finite value or divisor (or 0 divisor) → null. */
export function progressFillPercent(value: number, divisor: number = 100): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor === 0) return null;
  return clampNumber((value / divisor) * 100, 0, 100);
}

/** Format a raw progress value for display beside the bar/ring (trim floating-point noise). */
export function formatProgressValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Math.round(value * 1e6) / 1e6);
}

/** SVG circle geometry for a ring progress: circumference and the dash offset that
 *  reveals `percent` of the circle (0 → fully hidden, 100 → fully drawn). */
export function ringGeometry(percent: number, radius: number): { circumference: number; dashOffset: number } {
  const circumference = 2 * Math.PI * radius;
  const clamped = clampNumber(percent, 0, 100);
  const dashOffset = circumference * (1 - clamped / 100);
  return { circumference, dashOffset };
}
