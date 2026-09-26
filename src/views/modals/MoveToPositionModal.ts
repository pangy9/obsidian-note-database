import { App, Modal } from "obsidian";
import { t } from "../../i18n";
import { getMovePositionPreview } from "../../data/MovePosition";

/** One-based destination within the currently visible group/order. */
class MoveToPositionModal extends Modal {
  private resolve?: (position: number | null) => void;

  constructor(app: App, private current: number, private labels: readonly string[]) {
    super(app);
  }

  openAndWait(): Promise<number | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("note-database-modal", "db-move-position-modal");
    this.contentEl.createEl("h3", { text: t("mobile.moveToPosition") });
    const input = this.contentEl.createEl("input", {
      cls: "db-move-position-input",
      attr: {
        type: "number", min: "1", max: String(this.labels.length), step: "1", inputmode: "numeric",
        "aria-label": t("mobile.moveToPosition"),
      },
    });
    input.value = String(this.current);
    this.contentEl.createDiv({ cls: "db-modal-help", text: t("mobile.positionRange", { count: this.labels.length }) });
    const preview = this.contentEl.createDiv({ cls: "db-move-position-preview" });
    const renderPreview = (): void => {
      preview.empty();
      const position = getPosition();
      const context = position == null ? null : getMovePositionPreview(this.labels, this.current, position);
      if (!context) return;
      for (const [role, label] of [
        ["previous", context.previous ?? t("mobile.positionStart")],
        ["moved", context.moved],
        ["next", context.next ?? t("mobile.positionEnd")],
      ] as const) {
        const row = preview.createDiv({ cls: `db-move-position-preview-row is-${role}` });
        row.createSpan({ cls: "db-move-position-preview-role", text: t(`mobile.positionPreview.${role}`) });
        row.createSpan({ cls: "db-move-position-preview-label", text: label });
      }
    };
    const actions = this.contentEl.createDiv({ cls: "db-modal-actions" });
    actions.createEl("button", { text: t("common.cancel"), attr: { type: "button" } }).onclick = () => this.finish(null);
    const confirm = actions.createEl("button", {
      cls: "mod-cta", text: t("common.confirm"), attr: { type: "button" },
    });
    const getPosition = (): number | null => {
      const value = Number(input.value);
      return input.value.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= this.labels.length ? value : null;
    };
    input.oninput = () => { confirm.disabled = getPosition() == null; renderPreview(); };
    input.onkeydown = (event) => {
      if (event.key === "Enter" && getPosition() != null) {
        event.preventDefault();
        this.finish(getPosition());
      }
    };
    confirm.onclick = () => this.finish(getPosition());
    renderPreview();
    input.focus();
    input.select();
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(null);
  }

  private finish(position: number | null): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    if (this.modalEl.isShown()) this.close();
    resolve?.(position);
  }
}

export function promptMoveToPosition(app: App, current: number, labels: readonly string[]): Promise<number | null> {
  return new MoveToPositionModal(app, current, labels).openAndWait();
}
