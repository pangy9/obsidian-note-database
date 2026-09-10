import { App, Modal, Notice } from "obsidian";
import { makeModalDraggable } from "./ModalDrag";
import { t } from "../../i18n";
import { ColumnDef, ViewConfig } from "../../data/types";
import { COLUMN_TYPE_LABELS, isColumnType } from "../../data/ColumnTypes";
import { isFileFieldKey } from "../../data/FileFields";
import { createUniqueColumnKey } from "../../data/ColumnConfig";
import { createDropdownField } from "../DropdownField";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "../PropertyTypeIcon";
import { isImeComposing } from "../../data/KeyboardUtils";

export interface CreatePropertyResult {
  key: string;
  label: string;
  type: ColumnDef["type"];
}

export interface CreatePropertyModalOptions {
  initialLabel?: string;
  initialKey?: string;
  initialType?: ColumnDef["type"];
  /** Lock the type selector (e.g. record-icon field entry always needs text). */
  lockType?: boolean;
  /** Modal title; defaults to "Create property". */
  title?: string;
}

const PROPERTY_TYPES: ColumnDef["type"][] = [
  "text", "number", "date", "datetime", "currency", "checkbox",
  "select", "multi-select", "status",
  "computed", "relation", "rollup",
];

/**
 * Unified "create property" dialog. Collects a display label, a frontmatter key,
 * and a property type, then resolves the result (or null on cancel). Uses the
 * compact `.note-database-modal` / `db-modal-*` styles like other editor modals,
 * NOT the wide settings-popover layout. Escape cancels (Modal default → onClose).
 */
export class CreatePropertyModal extends Modal {
  private resolve?: (result: CreatePropertyResult | null) => void;
  private readonly config: ViewConfig;
  private readonly options: CreatePropertyModalOptions;
  private labelValue: string;
  private keyValue: string;
  private keyTouched: boolean;
  private typeValue: ColumnDef["type"];
  private labelInput?: HTMLInputElement;
  private keyInput?: HTMLInputElement;

  constructor(app: App, config: ViewConfig, options: CreatePropertyModalOptions = {}) {
    super(app);
    this.config = config;
    this.options = options;
    this.typeValue = options.initialType ?? "text";
    this.labelValue = options.initialLabel ?? "";
    this.keyValue = options.initialKey ?? "";
    this.keyTouched = Boolean(options.initialKey);
  }

  openAndWait(): Promise<CreatePropertyResult | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h3", { text: this.options.title ?? t("modal.createProperty") });

    makeModalDraggable(this);
    this.renderForm();

    const btnRow = contentEl.createDiv({ cls: "db-modal-button-row" });
    btnRow.createEl("button", { text: t("common.cancel") }).onclick = () => {
      this.resolve?.(null);
      this.close();
    };
    const okBtn = btnRow.createEl("button", { cls: "mod-cta", text: t("common.create") });
    okBtn.onclick = () => this.confirm();

    this.labelInput?.focus();
  }

  private renderForm(): void {
    const { contentEl } = this;
    const labels = COLUMN_TYPE_LABELS();
    const hasRelation = this.config.schema.columns.some((col) => col.type === "relation");

    const labelRow = contentEl.createDiv({ cls: "db-modal-row" });
    labelRow.createEl("label", { cls: "db-modal-label", text: t("modal.displayName") });
    this.labelInput = this.appendInput(labelRow, t("modal.displayName"), this.labelValue, (value) => {
      this.labelValue = value;
      // Mirror label → key until the user manually edits the key.
      if (!this.keyTouched) {
        this.keyValue = value;
        if (this.keyInput) this.keyInput.value = value;
      }
    });

    const keyRow = contentEl.createDiv({ cls: "db-modal-row db-modal-row-with-help" });
    keyRow.createEl("label", { cls: "db-modal-label", text: t("modal.frontmatterKey") });
    const keyControl = keyRow.createDiv({ cls: "db-modal-control-stack" });
    this.keyInput = this.appendInput(keyControl, t("modal.frontmatterKey"), this.keyValue, (value) => {
      this.keyValue = value;
      this.keyTouched = true;
    });
    keyControl.createDiv({ cls: "db-modal-help", text: t("modal.propertyKeyHint") });

    const typeRow = contentEl.createDiv({ cls: "db-modal-row" });
    typeRow.createEl("label", { cls: "db-modal-label", text: t("modal.propertyType") });
    createDropdownField({
      parent: typeRow,
      label: t("modal.propertyType"),
      options: PROPERTY_TYPES.map((type) => ({
        value: type,
        text: labels[type],
        icon: getPropertyDropdownIcon(type),
        // Rollup requires an existing relation to aggregate; without one it would
        // be created with an empty relationField. Disable + explain instead.
        ...(type === "rollup" && !hasRelation
          ? { disabled: true, disabledReason: t("modal.rollupNeedsRelation") }
          : {}),
      })),
      value: this.typeValue,
      className: "db-modal-dropdown",
      hideLabel: true,
      renderIcon: renderDropdownPropertyTypeIcon,
      disabled: this.options.lockType,
      onChange: (value) => {
        if (isColumnType(value)) this.typeValue = value;
      },
    });
  }

  private appendInput(parent: HTMLElement, placeholder: string, value: string, onInput: (value: string) => void): HTMLInputElement {
    const input = parent.createEl("input", {
      cls: "db-modal-input",
      attr: { type: "text", value, placeholder },
    });
    input.oninput = () => onInput(input.value);
    // Enter submits the form.
    input.addEventListener("keydown", (event) => {
      if (isImeComposing(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        this.confirm();
      }
    });
    return input;
  }

  private confirm(): void {
    const label = this.labelValue.trim();
    const rawKey = (this.keyValue || this.labelValue).trim();
    if (!rawKey) {
      new Notice(t("modal.propertyKeyRequired"));
      return;
    }
    if (isFileFieldKey(rawKey)) {
      new Notice(t("recordIcon.fileKeyInvalid"));
      return;
    }
    if (this.config.schema.columns.some((col) => col.key === rawKey)) {
      new Notice(t("modal.propertyKeyExists", { key: rawKey }));
      return;
    }
    const key = createUniqueColumnKey(this.config, rawKey);
    this.resolve?.({ key, label: label || key, type: this.typeValue });
    this.close();
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
