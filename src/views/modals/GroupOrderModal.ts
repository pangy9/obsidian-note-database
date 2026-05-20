import { App, Modal } from "obsidian";
import { mergeGroupOrder } from "../../data/GroupOrder";
import { t } from "../../i18n";

export class GroupOrderModal extends Modal {
  private order: string[];
  private draggedIndex: number | null = null;

  constructor(
    app: App,
    private fieldLabel: string,
    private groupKeys: string[],
    currentOrder: string[],
    private defaultOrder: string[],
    private onSave: (order: string[]) => void | Promise<void>
  ) {
    super(app);
    const knownKeys = new Set([...defaultOrder, ...groupKeys]);
    this.order = mergeGroupOrder(
      currentOrder.filter((key) => knownKeys.has(key)),
      defaultOrder,
      groupKeys
    );
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h2", { text: t("modal.groupOrderTitle", { field: this.fieldLabel }) });
    contentEl.createDiv({
      cls: "db-modal-help",
      text: t("modal.groupOrderHint"),
    });

    const list = contentEl.createDiv({ cls: "db-group-order-list" });
    this.order.forEach((key, index) => {
      const row = list.createDiv({ cls: "db-group-order-row" });
      row.draggable = true;
      row.ondragstart = (event) => this.startDrag(event, index, row);
      row.ondragover = (event) => {
        event.preventDefault();
        row.classList.add("is-drop-target");
      };
      row.ondragleave = () => row.classList.remove("is-drop-target");
      row.ondrop = (event) => this.dropOn(event, index, row);
      row.ondragend = () => this.finishDrag();

      row.createSpan({ cls: "db-group-order-drag", text: "⋮⋮" });
      row.createSpan({ cls: "db-group-order-name", text: key || t("common.uncategorized") });
      const controls = row.createDiv({ cls: "db-group-order-controls" });
      controls.createEl("button", { text: "↑" }).onclick = () => this.move(index, -1);
      controls.createEl("button", { text: "↓" }).onclick = () => this.move(index, 1);
    });

    const footer = contentEl.createDiv({ cls: "db-modal-actions" });
    if (this.defaultOrder.length > 0) {
      footer.createEl("button", { text: t("modal.resetToOptionOrder") }).onclick = () => {
        this.order = mergeGroupOrder(this.defaultOrder, this.groupKeys);
        this.render();
      };
    }
    footer.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    footer.createEl("button", { cls: "mod-cta", text: t("modal.saveOrder") }).onclick = async () => {
      await this.onSave([...this.order]);
      this.close();
    };
  }

  private move(index: number, offset: number): void {
    const next = index + offset;
    if (next < 0 || next >= this.order.length) return;
    [this.order[index], this.order[next]] = [this.order[next], this.order[index]];
    this.render();
  }

  private startDrag(event: DragEvent, index: number, row: HTMLElement): void {
    this.draggedIndex = index;
    row.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  private dropOn(event: DragEvent, targetIndex: number, row: HTMLElement): void {
    event.preventDefault();
    row.classList.remove("is-drop-target");
    const from = this.draggedIndex;
    if (from === null || from === targetIndex) {
      this.finishDrag();
      return;
    }

    const rect = row.getBoundingClientRect();
    let insertIndex = event.clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
    const [item] = this.order.splice(from, 1);
    if (from < insertIndex) insertIndex -= 1;
    this.order.splice(insertIndex, 0, item);
    this.finishDrag();
    this.render();
  }

  private finishDrag(): void {
    this.draggedIndex = null;
    this.contentEl.querySelectorAll(".db-group-order-row").forEach((row) => {
      row.classList.remove("is-dragging", "is-drop-target");
    });
  }
}
