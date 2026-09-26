import { setIcon } from "obsidian";
import { NumberDisplayStyle } from "../data/types";

const ICON_PREFIX = "number-display-style:";

export function getNumberDisplayStyleIcon(style: NumberDisplayStyle): string {
  return `${ICON_PREFIX}${style}`;
}

/** Shared by the column menu and property-edit modal, including dropdown buttons. */
export function renderNumberDisplayStyleIcon(parent: HTMLElement, style: NumberDisplayStyle): void {
  parent.addClass("db-number-style-menu-icon");
  if (style === "plain") {
    setIcon(parent, "hash");
    return;
  }
  if (style === "rating") {
    setIcon(parent, "star");
    return;
  }
  if (style === "progress") {
    const track = parent.createSpan({ cls: "db-number-style-menu-progress" });
    track.createSpan({ cls: "db-number-style-menu-progress-fill" });
    return;
  }

  const svg = parent.createSvg("svg", {
    attr: { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true" },
  });
  svg.createSvg("circle", {
    attr: { cx: 8, cy: 8, r: 5.5, fill: "none", "stroke-width": 3 },
  }).addClass("db-number-style-menu-ring-track");
  svg.createSvg("circle", {
    attr: {
      cx: 8,
      cy: 8,
      r: 5.5,
      fill: "none",
      "stroke-width": 3,
      "stroke-linecap": "round",
      "stroke-dasharray": "34.6",
      "stroke-dashoffset": "21",
      transform: "rotate(-90 8 8)",
    },
  }).addClass("db-number-style-menu-ring-arc");
}

export function renderDisplayStyleDropdownIcon(parent: HTMLElement, icon: string): void {
  if (icon.startsWith(ICON_PREFIX)) {
    const style = icon.slice(ICON_PREFIX.length);
    if (style === "plain" || style === "rating" || style === "progress" || style === "ring") {
      renderNumberDisplayStyleIcon(parent, style);
    }
    return;
  }
  setIcon(parent, icon);
}
