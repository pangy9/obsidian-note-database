import { App, Modal, Notice } from "obsidian";
import { ColumnDef, DatabaseConfig } from "../../data/types";
import { t } from "../../i18n";
import { createDropdownField, DropdownOption } from "../DropdownField";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "../PropertyTypeIcon";
import { getDatabaseDropdownIcon, renderDatabaseDropdownIcon } from "../RecordIconRenderer";

export class RelationRollupConfigModal extends Modal {
  constructor(
    app: App,
    private column: ColumnDef,
    private sourceDatabase: DatabaseConfig,
    private databases: DatabaseConfig[],
    private onSave: () => Promise<void>,
    private showDatabaseIcons = true,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("note-database-modal", "db-relation-rollup-config-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", {
      text: this.column.type === "relation" ? t("relation.configure") : t("rollup.configure"),
    });
    if (this.column.type === "relation") this.renderRelation();
    else if (this.column.type === "rollup") this.renderRollup();
  }

  private renderRelation(): void {
    let targetDatabaseId = this.column.relationConfig?.targetDatabaseId || this.databases[0]?.id || "";
    this.renderDropdownField(
      this.contentEl,
      t("relation.targetDatabase"),
      this.databases.map((database) => ({
        value: database.id,
        text: database.name || database.id,
        icon: getDatabaseDropdownIcon(database, this.showDatabaseIcons),
      })),
      targetDatabaseId,
      (value) => { targetDatabaseId = value; },
      renderDatabaseDropdownIcon,
    );
    this.renderActions(async () => {
      if (!targetDatabaseId) {
        new Notice(t("relation.targetDatabaseRequired"));
        return false;
      }
      this.column.relationConfig = { targetDatabaseId };
      this.column.rollupConfig = undefined;
      return true;
    });
  }

  private renderRollup(): void {
    const relationColumns = this.sourceDatabase.schema.columns.filter(
      (column) => column.type === "relation" && column.relationConfig?.targetDatabaseId
    );
    if (relationColumns.length === 0) {
      this.contentEl.createDiv({ cls: "db-empty", text: t("rollup.relationRequired") });
      this.renderCancelOnly();
      return;
    }
    let relationField = relationColumns.some((column) => column.key === this.column.rollupConfig?.relationField)
      ? this.column.rollupConfig!.relationField
      : relationColumns[0].key;
    let targetField = this.column.rollupConfig?.targetField || "";
    let aggregation = this.column.rollupConfig?.aggregation || "count";
    const configHost = this.contentEl.createDiv({ cls: "db-rollup-config-fields" });

    const renderFields = () => {
      configHost.empty();
      this.renderDropdownField(
        configHost,
        t("rollup.relationField"),
        relationColumns.map((column) => ({
          value: column.key,
          text: column.label || column.key,
          icon: getPropertyDropdownIcon(column.type),
        })),
        relationField,
        (value) => {
          relationField = value;
          targetField = "";
          renderFields();
        },
        renderDropdownPropertyTypeIcon,
      );
      const relation = relationColumns.find((column) => column.key === relationField);
      const targetDatabase = this.databases.find(
        (database) => database.id === relation?.relationConfig?.targetDatabaseId
      );
      const targetColumns = (targetDatabase?.schema.columns || []).filter(
        (column) => column.type !== "rollup"
      );
      if (!targetField || !targetColumns.some((column) => column.key === targetField)) {
        targetField = targetColumns[0]?.key || "file.name";
      }
      this.renderDropdownField(
        configHost,
        t("rollup.targetField"),
        [
          { value: "file.name", text: t("viewConfig.titleAuto"), icon: getPropertyDropdownIcon("text") },
          ...targetColumns
            .filter((column) => column.key !== "file.name")
            .map((column) => ({
              value: column.key,
              text: column.label || column.key,
              icon: getPropertyDropdownIcon(column.type),
            })),
        ],
        targetField,
        (value) => { targetField = value; },
        renderDropdownPropertyTypeIcon,
      );
      this.renderDropdownField(
        configHost,
        t("rollup.aggregation"),
        [
          { value: "count", text: t("viewConfig.summaryCount") },
          { value: "sum", text: t("chart.sumAggregation") },
          { value: "avg", text: t("chart.avgAggregation") },
          { value: "list", text: t("rollup.list") },
        ],
        aggregation,
        (value) => { aggregation = value as typeof aggregation; },
      );
    };
    renderFields();
    this.renderActions(async () => {
      if (!relationField || !targetField) {
        new Notice(t("rollup.configurationRequired"));
        return false;
      }
      this.column.rollupConfig = { relationField, targetField, aggregation };
      this.column.relationConfig = undefined;
      return true;
    });
  }

  private renderDropdownField(
    parent: HTMLElement,
    label: string,
    options: DropdownOption[],
    value: string,
    onChange: (value: string) => void,
    renderIcon?: (parent: HTMLElement, icon: string) => boolean,
  ): void {
    const field = parent.createDiv({ cls: "db-relation-rollup-config-field" });
    field.createDiv({ cls: "db-relation-rollup-config-label", text: label });
    createDropdownField({
      parent: field,
      label,
      value,
      options,
      hideLabel: true,
      className: "db-relation-rollup-config-dropdown",
      renderIcon: renderIcon ? (iconParent, icon) => { renderIcon(iconParent, icon); } : undefined,
      onChange,
    });
  }

  private renderActions(apply: () => Promise<boolean>): void {
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    row.createEl("button", { text: t("common.save"), cls: "mod-cta" }).onclick = async () => {
      if (!await apply()) return;
      await this.onSave();
      this.close();
    };
  }

  private renderCancelOnly(): void {
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("common.close") }).onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
