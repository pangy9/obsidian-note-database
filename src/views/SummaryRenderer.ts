import { RowData } from "../data/types";
import { t } from "../i18n";

export class SummaryRenderer {
  render(containerEl: HTMLElement, rows: RowData[]): void {
    const existing = containerEl.querySelector(".db-summary");
    if (existing) existing.remove();

    const summary = containerEl.createDiv({ cls: "db-summary" });
    const addItem = (label: string, value: string, style?: string) => {
      const div = summary.createDiv({ cls: "db-summary-item" });
      div.createDiv({ cls: "label", text: label });
      div.createSpan({ text: value, cls: "value", attr: style ? { style } : {} });
    };

    addItem(t("common.total"), String(rows.length));
  }
}
