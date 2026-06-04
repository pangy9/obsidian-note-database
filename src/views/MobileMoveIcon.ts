const SVG_NS = "http://www.w3.org/2000/svg";

/** Render the compact outline caret icon used by phone-only manual-order controls. */
export function renderMobileMoveIcon(target: HTMLElement): void {
  target.empty();
  const svg = window.activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon", "icon-tabler", "icon-tabler-caret-up-down");

  appendPath(svg, "m8 9 4-4 4 4");
  appendPath(svg, "m16 15-4 4-4-4");
  target.appendChild(svg);
}

function appendPath(svg: SVGSVGElement, d: string): void {
  const path = window.activeDocument.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  svg.appendChild(path);
}
