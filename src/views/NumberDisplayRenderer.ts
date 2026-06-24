import { setIcon } from "obsidian";
import { buildRatingSlots, formatProgressValue, progressFillPercent, ringGeometry, RatingSlot } from "../data/NumberDisplay";
import { NumberDisplayConfig } from "../data/types";

/** Fill width (%) of the accent overlay per slot: full=100, half=50, empty=0. */
const RATING_SLOT_FILL: Record<RatingSlot, number> = { full: 100, half: 50, empty: 0 };
const DEFAULT_RATING_EMOJI = "⭐";

/** Apply the tint color as a `db-num-color-<name>` class (CSS sets --db-number-color). */
function applyColorClass(el: HTMLElement, color: string | undefined): void {
  if (color) el.addClass(`db-num-color-${color}`);
}

/** Render a rating into `parent`: each slot is a faint base glyph with
 *  an accent overlay clipped to the fill width (full/half/empty).
 *  Caller must guarantee `value` is a finite number. */
export function renderRating(parent: HTMLElement, value: number, config?: NumberDisplayConfig): void {
  const max = config?.ratingMax && config.ratingMax > 0 ? config.ratingMax : 5;
  const symbol = config?.ratingSymbol || "star";
  const isEmoji = symbol === "emoji";
  const emoji = config?.ratingEmoji?.trim() || DEFAULT_RATING_EMOJI;
  const container = parent.createSpan({
    cls: `db-cell-rating${config?.ratingVariant === "outline" && !isEmoji ? " is-outline" : ""}${isEmoji ? " is-emoji" : ""}`,
  });
  if (!isEmoji) applyColorClass(container, config?.color);
  for (const slot of buildRatingSlots(value, max)) {
    const star = container.createSpan({ cls: "db-rating-star" });
    const bg = star.createSpan({ cls: "db-rating-star-bg" });
    if (isEmoji) bg.createSpan({ cls: "db-rating-emoji", text: emoji });
    else setIcon(bg, symbol);
    const fg = star.createSpan({ cls: "db-rating-star-fg" });
    fg.style.width = `${RATING_SLOT_FILL[slot]}%`;
    if (isEmoji) fg.createSpan({ cls: "db-rating-emoji", text: emoji });
    else setIcon(fg, symbol);
  }
}

/** Render a progress bar into `parent`. fill = value/divisor; text = raw value when showValue.
 *  Caller must guarantee `value` is a finite number. */
export function renderProgress(parent: HTMLElement, value: number, config?: NumberDisplayConfig): void {
  const divisor = config?.progressDivisor && config.progressDivisor > 0 ? config.progressDivisor : 100;
  const percent = progressFillPercent(value, divisor);
  if (percent == null) return;
  const showValue = config?.progressShowValue !== false;
  const container = parent.createDiv({ cls: "db-cell-progress" });
  applyColorClass(container, config?.color);
  const track = container.createDiv({ cls: "db-cell-progress-track" });
  const fill = track.createDiv({ cls: "db-cell-progress-fill" });
  fill.style.width = `${percent}%`;
  if (showValue) container.createSpan({ cls: "db-cell-progress-text", text: formatProgressValue(value) });
}

/** Render a circular ring progress into `parent`. fill = value/divisor; the raw value is shown
 *  beside the ring when showValue (Notion-style, ring center empty). */
export function renderProgressRing(parent: HTMLElement, value: number, config?: NumberDisplayConfig): void {
  const divisor = config?.progressDivisor && config.progressDivisor > 0 ? config.progressDivisor : 100;
  const percent = progressFillPercent(value, divisor);
  if (percent == null) return;
  const showValue = config?.progressShowValue !== false;
  const RADIUS = 9;
  const { circumference, dashOffset } = ringGeometry(percent, RADIUS);
  const container = parent.createSpan({ cls: "db-cell-progress-ring" });
  applyColorClass(container, config?.color);
  const svg = container.createSvg("svg", { attr: { viewBox: "0 0 24 24", width: 20, height: 20 } });
  svg.createSvg("circle", { attr: { cx: 12, cy: 12, r: RADIUS, fill: "none", "stroke-width": 4 } })
    .addClass("db-progress-ring-track");
  svg.createSvg("circle", {
    attr: {
      cx: 12, cy: 12, r: RADIUS, fill: "none", "stroke-width": 4, "stroke-linecap": "round",
      "stroke-dasharray": String(circumference), "stroke-dashoffset": String(dashOffset),
      transform: "rotate(-90 12 12)",
    },
  }).addClass("db-progress-ring-arc");
  if (showValue) container.createSpan({ cls: "db-progress-ring-text", text: formatProgressValue(value) });
}
