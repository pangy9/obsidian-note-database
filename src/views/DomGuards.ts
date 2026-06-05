function hasInstanceOf(value: unknown): value is Node {
  return (typeof Node !== "undefined" && value instanceof Node) || (typeof value === "object" && value !== null && "instanceOf" in value);
}

export function isElement(value: unknown): value is Element {
  return hasInstanceOf(value) && value.instanceOf(Element);
}

export function isHTMLElement(value: unknown): value is HTMLElement {
  return hasInstanceOf(value) && value.instanceOf(HTMLElement);
}
