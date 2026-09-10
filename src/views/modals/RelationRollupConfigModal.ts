import { App, Modal, Notice } from "obsidian";
import { makeModalDraggable } from "./ModalDrag";
import { isRollupNumericTarget } from "../../data/ColumnDisplay";
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
    private onSave: (result: RelationRollupConfigResult) => Promise<void>,
    private showDatabaseIcons = true,
    private getRelationImpact?: (targetDatabaseId: string) => RelationTargetChangeImpact,
    private onClosed?: () => void,
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
    makeModalDraggable(this);
    if (this.column.type === "relation") this.renderRelation();
    else if (this.column.type === "rollup") this.renderRollup();
  }

  private renderRelation(): void {
    const initialTargetDatabaseId = this.column.relationConfig?.targetDatabaseId || "";
    let targetDatabaseId = initialTargetDatabaseId || this.databases[0]?.id || "";
    let saveButton: HTMLButtonElement | undefined;
    let impactHost: HTMLElement | undefined;
    const renderImpact = () => {
      if (!impactHost) return;
      impactHost.empty();
      const changed = Boolean(initialTargetDatabaseId && targetDatabaseId !== initialTargetDatabaseId);
      const impact = changed ? this.getRelationImpact?.(targetDatabaseId) : undefined;
      if (impact) {
        const notice = impactHost.createDiv({ cls: "db-relation-target-impact" });
        notice.createDiv({
          cls: "db-relation-target-impact-main",
          text: t("relation.targetChangeImpact", {
            records: impact.clearRecordCount,
            rollups: impact.dependentRollupCount,
          }),
        });
        if (impact.invalidatedRollupLabels.length > 0) {
          notice.createDiv({
            cls: "db-relation-target-impact-detail",
            text: t("relation.targetChangeInvalidRollups", {
              names: impact.invalidatedRollupLabels.join(", "),
            }),
          });
        }
      }
      if (saveButton) {
        saveButton.textContent = changed && (impact?.clearRecordCount || 0) > 0
          ? t("relation.saveAndClear")
          : t("common.save");
      }
    };
    this.renderDropdownField(
      this.contentEl,
      t("relation.targetDatabase"),
      this.databases.map((database) => ({
        value: database.id,
        text: database.name || database.id,
        icon: getDatabaseDropdownIcon(database, this.showDatabaseIcons),
      })),
      targetDatabaseId,
      (value) => { targetDatabaseId = value; renderImpact(); },
      renderDatabaseDropdownIcon,
    );
    impactHost = this.contentEl.createDiv({ cls: "db-relation-target-impact-host" });
    saveButton = this.renderActions(async () => {
      if (!targetDatabaseId) {
        new Notice(t("relation.targetDatabaseRequired"));
        return false;
      }
      await this.onSave({ type: "relation", targetDatabaseId });
      return true;
    });
    renderImpact();
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
      // Bug T：目标字段按 aggregation 过滤——sum/avg 仅数值列（getColumnDisplayType === "number"，
      // 含数字 computed，排除 file.name / text / date / checkbox computed）；list/count 允许所有非
      // rollup 列（含 file.name / relation）。aggregation 变更触发 renderFields 重选。
      const isSumAvg = aggregation === "sum" || aggregation === "avg";
      const isNumericTarget = (column: ColumnDef) =>
        isRollupNumericTarget(column, targetDatabase?.schema.computedFields);
      const targetColumns = (targetDatabase?.schema.columns || []).filter((column) => {
        if (column.type === "rollup") return false;
        if (isSumAvg) return isNumericTarget(column);
        return true;
      });
      if (!targetField || !targetColumns.some((column) => column.key === targetField)) {
        // sum/avg 无数值字段时 targetField 留空（保存时提示）；count/list 保留 file.name 兼容。
        targetField = isSumAvg ? (targetColumns[0]?.key || "") : (targetColumns[0]?.key || "file.name");
      }
      this.renderDropdownField(
        configHost,
        t("rollup.targetField"),
        [
          ...(isSumAvg ? [] : [{ value: "file.name", text: t("viewConfig.titleAuto"), icon: getPropertyDropdownIcon("text") }]),
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
        (value) => { aggregation = value as typeof aggregation; renderFields(); },
      );
    };
    renderFields();
    this.renderActions(async () => {
      if (!relationField || !targetField) {
        new Notice(t("rollup.configurationRequired"));
        return false;
      }
      await this.onSave({ type: "rollup", relationField, targetField, aggregation });
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

  private renderActions(apply: () => Promise<boolean>): HTMLButtonElement {
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const save = row.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    save.onclick = async () => {
      if (!await apply()) return;
      this.close();
    };
    return save;
  }

  private renderCancelOnly(): void {
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("common.close") }).onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.onClosed?.();
  }
}

export interface RelationTargetChangeImpact {
  clearRecordCount: number;
  dependentRollupCount: number;
  invalidatedRollupLabels: string[];
}

export type RelationRollupConfigResult =
  | { type: "relation"; targetDatabaseId: string }
  | {
    type: "rollup";
    relationField: string;
    targetField: string;
    aggregation: "count" | "sum" | "avg" | "list";
  };
