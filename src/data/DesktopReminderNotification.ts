import type { ReminderInboxTarget } from "./RecordReminderNotice";

interface DesktopNotificationWindow extends Pick<Window, "setInterval" | "clearInterval" | "setTimeout" | "clearTimeout"> {
  Notification?: typeof Notification;
  // Query the specific BrowserWindow, not whichever Obsidian document is active.
  // eslint-disable-next-line obsidianmd/prefer-active-doc
  document?: Pick<Document, "hasFocus">;
  addEventListener?(type: "focus", callback: () => void): void;
  removeEventListener?(type: "focus", callback: () => void): void;
  closed?: boolean;
  focus: () => void;
  require?: (id: string) => unknown;
  electronWindow?: NativeReminderWindow;
}

interface NativeReminderWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

interface DesktopRemote {
  getCurrentWindow?: () => NativeReminderWindow;
  BrowserWindow?: { getFocusedWindow(): NativeReminderWindow | null };
}

function desktopRemote(win: DesktopNotificationWindow | null): DesktopRemote | undefined {
  // The host exposes this bridge on desktop (also used by Obsidian's native menus).
  // No window enumeration: getCurrentWindow is bound to the issuing renderer.
  try {
    const electron = win?.require?.("electron") as { remote?: DesktopRemote } | undefined;
    return electron?.remote ?? win?.require?.("@electron/remote") as DesktopRemote | undefined;
  } catch { return undefined; }
}

interface ReminderWindowRouting {
  getInboxWindow?: () => DesktopNotificationWindow | null | undefined;
  isActiveWindow?: (win: DesktopNotificationWindow) => boolean;
  onStatusChange?: () => void;
}

export type DesktopReminderPermission = NotificationPermission | "unavailable";
export type DesktopReminderTest = "sent" | "timed-out" | "unavailable";

/** Desktop Electron exposes the standard Web Notifications API. Never used on mobile. */
export class DesktopReminderNotification {
  private readonly alerts = new Map<Notification, { delivered: boolean; fallback: () => void }>();
  private testNotification?: Notification;
  private cancelTestWait?: () => void;
  private verified = false;
  private testRequest = 0;
  private cancelActivation?: () => void;

  constructor(
    private readonly getWindow: () => DesktopNotificationWindow | null,
    private readonly enabled: () => boolean,
    private readonly isAppFocused: () => boolean,
    private readonly openInbox: (reminder?: ReminderInboxTarget) => void,
    private readonly routing: ReminderWindowRouting = {},
  ) {}

  permission(): DesktopReminderPermission {
    try { return this.getWindow()?.Notification?.permission ?? "unavailable"; }
    catch { return "unavailable"; }
  }

  hasVerifiedDelivery(): boolean { return this.permission() === "granted" && this.verified; }

  private foreground(win: DesktopNotificationWindow): boolean {
    try { if (desktopRemote(win)?.BrowserWindow?.getFocusedWindow()) return true; }
    catch { /* Fall through to document focus. */ }
    return this.isAppFocused();
  }

  private raise(win: DesktopNotificationWindow): void {
    try {
      // Obsidian attaches the exact native window to every renderer, including pop-outs.
      const native = win.electronWindow ?? desktopRemote(win)?.getCurrentWindow?.();
      if (native && !native.isDestroyed()) {
        if (native.isMinimized()) native.restore();
        native.show();
        native.focus();
      } else win.focus();
    } catch {
      try { win.focus(); } catch { /* The renderer may have closed. */ }
    }
  }

  private activate(issuingWindow: DesktopNotificationWindow, reminder?: ReminderInboxTarget): void {
    this.cancelActivation?.();
    // An already open inbox is mounted in its own window, irrespective of activeWindow.
    const existing = this.routing.getInboxWindow?.();
    const target = existing && !existing.closed ? existing : issuingWindow;
    this.raise(target);
    if (target === existing) {
      this.openInbox(reminder);
      return;
    }

    let timer: number | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) issuingWindow.clearTimeout(timer);
      target.removeEventListener?.("focus", focused);
      this.cancelActivation = undefined;
    };
    const isReady = (): boolean => {
      if (!this.enabled() || target.closed) {
        cleanup();
        return true;
      }
      // Modal.open attaches to Obsidian's activeWindow, updated by its DOM focus
      // listener after a native focus call. It may be safe before OS focus is
      // granted if the host already identifies this vault window as active.
      const correctWindow = this.routing.isActiveWindow?.(target) ?? target.document?.hasFocus() !== false;
      if (!correctWindow) return false;
      cleanup();
      this.openInbox(reminder);
      return true;
    };
    const check = (remaining: number): void => {
      if (timer !== undefined) issuingWindow.clearTimeout(timer);
      timer = undefined;
      if (isReady() || remaining <= 0) return;
      timer = issuingWindow.setTimeout(() => check(remaining - 1), 25);
    };
    // A window manager can decline to focus us. After the short polling
    // window, keep only a passive listener so manually focusing still works.
    const focused = () => { check(40); };
    this.cancelActivation = cleanup;
    target.addEventListener?.("focus", focused);
    check(40);
  }

  /** Exercise the same background delivery path as a real reminder, without touching the queue. */
  async sendTest(title: string, body: string, onError: () => void,
    onVerified: () => void = () => {}): Promise<DesktopReminderTest> {
    if (!this.enabled()) return "unavailable";
    const request = ++this.testRequest;
    this.cancelTestWait?.();
    await this.requestPermission();
    const win = this.getWindow();
    if (request !== this.testRequest || !win || !this.enabled() || this.permission() !== "granted") return "unavailable";
    if (this.foreground(win)) {
      const result = await this.waitForBackground(win);
      if (result !== "ready") return result;
    }
    if (request !== this.testRequest || !this.enabled() || win !== this.getWindow()) return "unavailable";
    this.closeTest();
    return this.post(win, title, body, true, onError, onVerified) ? "sent" : "unavailable";
  }

  private waitForBackground(win: DesktopNotificationWindow): Promise<"ready" | "timed-out" | "unavailable"> {
    return new Promise(resolve => {
      const stop = (result: "ready" | "timed-out" | "unavailable"): void => {
        win.clearInterval(check);
        win.clearTimeout(timeout);
        this.cancelTestWait = undefined;
        resolve(result);
      };
      const check = win.setInterval(() => {
        if (!this.enabled() || this.getWindow() !== win) stop("unavailable");
        else if (!this.foreground(win)) stop("ready");
      }, 350);
      const timeout = win.setTimeout(() => stop("timed-out"), 30_000);
      this.cancelTestWait = () => stop("unavailable");
    });
  }

  private closeTest(): void {
    const alert = this.testNotification;
    this.testNotification = undefined;
    if (!alert) return;
    alert.onclick = alert.onerror = alert.onclose = null;
    try { alert.close(); } catch { /* System surface already closed. */ }
  }

  destroy(fallbackUndelivered = false): void {
    this.cancelActivation?.();
    this.testRequest++;
    this.cancelTestWait?.();
    this.close(fallbackUndelivered);
    this.closeTest();
  }

  async requestPermission(): Promise<void> {
    try {
      const NotificationAPI = this.getWindow()?.Notification;
      if (NotificationAPI?.permission === "default") {
        try { await NotificationAPI.requestPermission(); }
        finally { this.routing.onStatusChange?.(); }
      }
    } catch {
      // OS permissions and unavailable runtimes are handled by in-app delivery.
    }
  }

  closeIfDisabled(): void {
    if (!this.enabled()) this.destroy(true);
  }

  show(title: string, body: string, onError: () => void, reminder?: ReminderInboxTarget): boolean {
    const win = this.getWindow();
    if (!this.enabled() || !win || this.foreground(win)) return false;
    return this.post(win, title, body, false, onError, undefined, reminder);
  }

  private post(win: DesktopNotificationWindow, title: string, body: string, test: boolean,
    onError: () => void, onVerified?: () => void, reminder?: ReminderInboxTarget): boolean {
    const NotificationAPI = win.Notification;
    if (!NotificationAPI || NotificationAPI.permission !== "granted") return false;
    try {
      const notification = new NotificationAPI(title, { body });
      const alert = { delivered: false, fallback: onError };
      if (test) this.testNotification = notification;
      else this.alerts.set(notification, alert);
      const matches = () => test ? this.testNotification === notification : this.alerts.has(notification);
      const close = () => test ? this.closeTest() : this.closeAlert(notification);
      if (!test) notification.onshow = () => { alert.delivered = true; };
      notification.onclick = (event) => {
        if (!matches() || !this.enabled()) return;
        // Stop the default app-level activation from selecting a different vault window.
        event?.preventDefault();
        this.verified = true;
        close();
        this.activate(win, reminder);
        this.routing.onStatusChange?.();
        onVerified?.();
      };
      notification.onerror = () => {
        if (!matches()) return;
        this.verified = false;
        close();
        this.routing.onStatusChange?.();
        if (this.enabled()) onError();
      };
      notification.onclose = () => {
        if (!matches()) return;
        if (test) this.testNotification = undefined;
        else this.alerts.delete(notification);
      };
      return true;
    } catch { return false; }
  }

  private closeAlert(notification: Notification): void {
    this.alerts.delete(notification);
    notification.onclick = notification.onerror = notification.onclose = notification.onshow = null;
    try { notification.close(); } catch { /* A closed OS surface needs no further cleanup. */ }
  }

  /** Clear all previous previews. Fall back only if a batch has not been delivered yet. */
  close(fallbackUndelivered = false): void {
    for (const [notification, alert] of this.alerts) {
      this.closeAlert(notification);
      if (fallbackUndelivered && !alert.delivered) alert.fallback();
    }
  }
}
