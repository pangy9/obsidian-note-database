import { parseDateKeyToUtc } from "../data/CalendarDateTime";

export interface TimelinePanPosition {
  navigation: string;
  anchor: string;
  minutes: number;
  offsetUnits: number;
}

type PositionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PositionTimers = Pick<Window, "setTimeout" | "clearTimeout">;

/** Like header collapse, browsing position is local UI state, not a shared database edit. */
export function timelinePanPositionKey(vaultId: string, source: string, viewId: string): string {
  return `note-database:timeline-position:${JSON.stringify([vaultId.split("?")[0], source, viewId])}`;
}

export class TimelinePanPositionStore {
  private timer: number | undefined;
  private pending: string | undefined;
  private lastSaved: string | undefined;

  constructor(private storage: PositionStorage, private timers: PositionTimers, readonly key: string) {}

  load(navigation: string): TimelinePanPosition | undefined {
    try {
      const raw = this.storage.getItem(this.key);
      this.lastSaved = raw || undefined;
      const position: unknown = JSON.parse(raw || "null");
      if (!position || typeof position !== "object") return;
      const p = position as Partial<TimelinePanPosition>;
      if (p.navigation !== navigation || typeof p.anchor !== "string" || !parseDateKeyToUtc(p.anchor) ||
        typeof p.minutes !== "number" || !Number.isInteger(p.minutes) || p.minutes < 0 || p.minutes >= 1440 ||
        typeof p.offsetUnits !== "number" || !Number.isFinite(p.offsetUnits) || Math.abs(p.offsetUnits) > 1000000) return;
      return p as TimelinePanPosition;
    } catch { return; }
  }

  schedule(position: TimelinePanPosition): void {
    const value = JSON.stringify(position);
    if (this.timer != null) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = value === this.lastSaved ? undefined : value;
    if (this.pending != null) this.timer = this.timers.setTimeout(() => this.flush(), 600);
  }

  flush(): void {
    if (this.timer != null) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending == null) return;
    try {
      this.storage.setItem(this.key, this.pending);
      this.lastSaved = this.pending;
      this.pending = undefined;
    } catch { /* Unavailable local storage must not interrupt timeline navigation. */ }
  }

  /** Explicit navigation supersedes a pending pan, even when jumping to the same saved anchor. */
  clear(): void {
    if (this.timer != null) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.lastSaved = undefined;
    try { this.storage.removeItem(this.key); } catch { /* Keep navigation usable. */ }
  }
}
