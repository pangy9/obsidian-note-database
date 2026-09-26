// Opt-in diagnostics. Never records cell values, clipboard contents or note paths.
type DebugWindow = Window & {
  __NOTE_DATABASE_DEBUG_EVENTS__?: boolean;
  __NOTE_DATABASE_EVENT_LOG__?: string[];
};

export function traceDatabaseInteraction(doc: Document, source: string, details: Record<string, unknown> = {}): void {
  const win = doc.defaultView as DebugWindow | null;
  if (!win?.__NOTE_DATABASE_DEBUG_EVENTS__) return;
  const line = JSON.stringify({ time: Date.now(), source, ...details });
  const log = win.__NOTE_DATABASE_EVENT_LOG__ ??= [];
  log.push(line);
  if (log.length > 200) log.shift();
  // User-enabled, bounded diagnostics for an intermittent UI event bug.
  // eslint-disable-next-line obsidianmd/rule-custom-message
  console.log("[NoteDatabase events]", line);
}

export function installInteractionDiagnostics(container: HTMLElement, id: string): () => void {
  const doc = container.ownerDocument;
  const describe = (target: EventTarget | null): string => {
    const element = target as Element | null;
    return element?.nodeType === 1 ? `${element.tagName}.${Array.from(element.classList).join(".")}` : "other";
  };
  const listener = (event: Event) => {
    const win = doc.defaultView as DebugWindow | null;
    if (!win?.__NOTE_DATABASE_DEBUG_EVENTS__) return;
    const mouse = event as MouseEvent;
    const keyboard = event as KeyboardEvent;
    traceDatabaseInteraction(doc, `event:${id}`, {
      type: event.type, target: describe(event.target), insideEmbed: container.contains(event.target as Node),
      activeElement: describe(doc.activeElement), detail: mouse.detail,
      x: mouse.clientX, y: mouse.clientY, prevented: event.defaultPrevented,
      trusted: event.isTrusted,
      key: (event.type === "keydown" || event.type === "keyup") && ["c", "C", "Meta", "Control", "Enter", "Escape"].includes(keyboard.key) ? keyboard.key : undefined,
      ctrl: keyboard.ctrlKey, meta: keyboard.metaKey,
    });
  };
  const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "keydown", "keyup", "focusin"];
  const options = { capture: true };
  for (const type of events) doc.addEventListener(type, listener, options);
  return () => { for (const type of events) doc.removeEventListener(type, listener, options); };
}
