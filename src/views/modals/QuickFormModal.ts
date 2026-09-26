// 快速采集表单弹窗：任意视图工具栏/命令面板触发的快捷采集入口。与表单视图共用
// FormRenderer；提交走 DatabaseView.createEntryFromForm 的三段闸门（目标库身份 +
// 规则指纹），失败保留草稿。桌面可拖拽，移动端为 Obsidian 原生全屏 sheet。
import { App, Modal } from "obsidian";
import { t } from "../../i18n";
import { SourceRuleNode, ViewConfig } from "../../data/types";
import { FormCreateInput } from "../../data/FormModel";
import { FormRenderer } from "../FormRenderer";
import { DatabaseView } from "../DatabaseView";
import { makeModalDraggable } from "./ModalDrag";

export interface QuickFormTarget {
  /** 数据库定义文件路径（提交闸门的身份比对 + 封面链接基准）。 */
  sourcePath: string;
  /** 规划快照视图（优先库内 form 视图，否则当前视图 + 空 form 字段）。 */
  viewConfig: ViewConfig;
  /** 打开瞬间按 getCreateContextConfig 语义合并的规则树（提交时做指纹比对）。 */
  mergedRuleTree: SourceRuleNode | undefined;
  /** 与创建直接相关的配置快照，用于提交前检测配置变化。 */
  creationFingerprint: string;
  /** 打开时的视图筛选默认值；切换视图后不能读取新视图的筛选。 */
  filterDefaults: Record<string, unknown>;
}

export class QuickFormModal extends Modal {
  private formRenderer = new FormRenderer();

  constructor(
    app: App,
    private view: DatabaseView,
    private target: QuickFormTarget,
    private hiddenColumnKeys: ReadonlySet<string>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("db-quick-form-modal");
    this.contentEl.addClass("note-database-modal", "db-quick-form-content");
    const heading = this.contentEl.createDiv({ cls: "db-quick-form-heading" });
    heading.createEl("h3", { text: t("form.modalTitle") });
    heading.createSpan({ cls: "db-quick-form-source", text: this.target.viewConfig.name });
    makeModalDraggable(this);
    const host = this.contentEl.createDiv({ cls: "note-database-container db-form-modal-host" });
    this.formRenderer.render(host, this.target.viewConfig, this.target.mergedRuleTree, this.hiddenColumnKeys, {
      submitForm: async (input: FormCreateInput) => Boolean(await this.view.createEntryFromForm(this.target, input, this.formRenderer.getPlan())),
      getRelationRecords: (col) => this.view.getFormRelationRecords(col),
      getSourcePath: () => this.target.sourcePath,
      updateOptions: (col, before, next, removed) => this.view.updateFormColumnOptions(this.target.sourcePath, col, before, next, removed),
      app: this.app,
    }, {
      keepOpenAfterSubmit: "close",
      draftKey: `modal:${this.target.sourcePath}:${this.target.viewConfig.id}`,
      hideHeader: true,
      onSubmitted: () => this.close(),
    });
  }

  onClose(): void {
    this.formRenderer.destroy();
    this.contentEl.empty();
  }
}
