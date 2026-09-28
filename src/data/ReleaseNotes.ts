// 各版本的更新日志文案（从各 release tag 的 i18n 提取归档），按版本倒序维护。
// 弹窗按「上次已读版本 < v <= 当前版本」区间拼接展示：用户跨多个版本升级时
// 能看到期间全部更新。新增版本时把三语文案加到 RELEASE_NOTES 头部即可。
// obsidian-free 纯数据 + 纯函数，vitest 可直测。

export type ReleaseNotesLocale = "en" | "zh-CN" | "zh-TW" | "system";

export const RELEASE_NOTES: ReadonlyArray<{
  version: string;
  notes: Record<Exclude<ReleaseNotesLocale, "system">, string>;
}> = [
  {
    version: "1.3.1",
    notes: {
      en: "## What's new in 1.3.1\n\n- **Reorder from the desktop context menu:** right-click any record in table, board, gallery, list, or timeline views to move it up, down, to a specific position, or pick a target record to place it before or after — including across groups.\n- **Custom database templates:** save a configured database as a starter template, optionally with sample records, and reuse it when creating new databases in the same vault.\n- **Fuller update notes on upgrade:** when you upgrade across several versions, the changelog dialog now shows every version released in between.\n\nEverything remains local Markdown in your vault.",
      "zh-CN": "## 1.3.1 更新内容\n\n- **桌面端右键排序：** 在表格、看板、画廊、列表与时间线中右键任意记录即可上移、下移、移动到指定位置，或进入点选模式将它放到任意记录前后——跨分组移动同样支持。\n- **自定义数据库模板：** 把配置好的数据库保存为起步模板（可选包含示例记录），在同一 vault 新建数据库时直接复用。\n- **升级更全面的更新日志：** 跨多个版本升级时，弹窗会展示期间所有版本的更新内容。\n\n所有记录仍保存在 vault 内的本地 Markdown 文件中。",
      "zh-TW": "## 1.3.1 更新內容\n\n- **桌面端右鍵排序：** 在表格、看板、畫廊、列表與時間線中右鍵任意記錄即可上移、下移、移動到指定位置，或進入點選模式將它放到任意記錄前後——跨分組移動同樣支援。\n- **自訂資料庫範本：** 把設定好的資料庫儲存為起步範本（可選包含範例記錄），在同一 vault 新增資料庫時直接重複使用。\n- **升級更全面的更新日誌：** 跨多個版本升級時，彈出視窗會顯示期間所有版本的更新內容。\n\n所有記錄仍保存在 vault 內的本機 Markdown 檔案中。",
    },
  },
  {
    version: "1.3.0",
    notes: {
      en: "## What's new in 1.3.0\n\n- **Form view and Quick Capture:** collect notes through field-aware forms in a saved view or a toolbar/command dialog. Set required fields, choose a cover layout, and keep unfinished drafts while switching views.\n- **Six database starters:** begin with a project tracker, content calendar, reading library, research library, lightweight CRM, or task planner. Each includes matching views and settings, with optional sample records.\n- **Editable embeds:** opt in to editing records inside embedded databases, including bulk changes and undo; drag the lower edge to adjust a code block's height.\n- **Record templates:** Markdown, Obsidian Templates, and Templater content now applies consistently across note-creation paths.\n- **Faster property and mobile workflows:** edit a property's type and display style in one dialog; move records and options with touch-friendly controls.\n- **Database discovery and embed spacing:** refresh the Dashboard list when database files are added or moved; tighten spacing below the embedded selection toolbar.\n- **Timeline all-day event colors:** conditional formatting and the Event color setting now appear on all-day bars (GitHub issue #8).\n- **Stable database ordering:** existing databases keep their order, and new ones are appended instead of unexpectedly sorting alphabetically.\n\nEverything remains local Markdown in your vault.",
      "zh-CN": "## 1.3.0 更新内容\n\n- **表单视图与快速采集：** 在独立视图、工具栏或命令面板按字段类型填写新笔记；可设置必填、封面布局，切换视图时保留未提交草稿。\n- **六种数据库起步模板：** 项目追踪、内容日历、阅读媒体、研究资料、轻量 CRM 和任务规划，附带对应视图与配置，可选添加示例记录。\n- **可编辑内嵌数据库：** 按设置启用内嵌编辑、批量修改与撤销；拖动代码块底边可调整高度。\n- **记录模板贯通新建入口：** Markdown、Obsidian Templates 与 Templater 模板可在不同新建路径中一致应用。\n- **属性与移动端操作：** 在属性编辑窗口修改类型和显示样式；用更易触控的操作调整记录与选项顺序。\n- **数据库自动发现与内嵌留白：** 新增或移入数据库文件时更新 Dashboard 列表，并收紧内嵌选区状态栏下方空白。\n- **时间线全天事件颜色：** 修复条件格式和「事件颜色」设置未显示在全天事件条上的问题（GitHub issue #8）。\n- **稳定数据库顺序：** 保留已有数据库原顺序，新建数据库追加到末尾，不再意外按字典序重排。\n\n所有记录仍保存在 vault 内的本地 Markdown 文件中。",
      "zh-TW": "## 1.3.0 更新內容\n\n- **表單檢視與快速採集：** 在獨立檢視、工具列或命令面板依欄位類型填寫新筆記；可設定必填、封面版面，切換檢視時保留未送出的草稿。\n- **六種資料庫起步範本：** 專案追蹤、內容日曆、閱讀媒體、研究資料、輕量 CRM 與任務規劃，附帶對應檢視和設定，可選擇加入範例記錄。\n- **可編輯內嵌資料庫：** 依設定啟用內嵌編輯、批次修改與復原；拖曳程式碼區塊底邊可調整高度。\n- **記錄範本貫通新增入口：** Markdown、Obsidian Templates 與 Templater 範本可在不同新增路徑中一致套用。\n- **屬性與行動端操作：** 在屬性編輯視窗修改類型及顯示樣式；以更容易觸控的操作調整記錄與選項順序。\n- **資料庫自動發現與內嵌留白：** 新增或移入資料庫檔案時更新 Dashboard 清單，並收緊內嵌選區狀態列下方空白。\n- **時間線全天事件顏色：** 修復條件格式和「事件顏色」設定未顯示於全天事件條上的問題（GitHub issue #8）。\n- **穩定資料庫順序：** 保留既有資料庫原順序，新建資料庫追加至清單末尾，不再意外按字典序重新排列。\n\n所有記錄仍然只是儲存在本機的 Markdown 和 Obsidian 雙鏈。",
    },
  },
  {
    version: "1.2.9",
    notes: {
      en: "## What's new in 1.2.9\n\n- **Automatic formula sync:** computed columns can now write results back to notes automatically — enable it per database or vault-wide.\n- **Atomic column rename:** renaming a property rewrites every affected note in one undoable transaction, with formatting preserved afterwards.\n- **Relation integrity:** broken links are marked as missing or out of scope with distinct styling, and recover automatically when files return.\n- **Movable, copyable windows:** drag any plugin dialog by the grip next to its title, and select or copy text in dialogs and popovers.\n- **Better Bases import:** search and sort the property list, prefer .base display names as column titles, and choose how each formula property imports.\n- **Reliability fixes:** disk reconciliation for external edits, mobile popover positioning, iPad toolbar icons, and narrow-screen formula suggestions.\n\nYour notes and relationships remain ordinary local Markdown and Obsidian wikilinks.",
      "zh-CN": "## 1.2.9 更新内容\n\n- **公式自动同步：** 计算字段的结果可自动写回笔记，支持按数据库或全库启用。\n- **列重命名事务化：** 重命名属性以单个可撤销事务改写所有受影响的笔记，完成后格式化显示保留。\n- **关联完整性：** 失效链接按「未找到 / 超出范围」分别标识，文件恢复后自动还原。\n- **可拖动、可复制的窗口：** 所有插件弹窗可按标题旁的手柄拖动，弹窗与气泡中的文字可选中复制。\n- **更强的 Bases 转换：** 属性列表支持搜索与排序，.base 显示名优先作为列标题，公式属性可选择按计算字段或文本导入。\n- **稳定性修复：** 外部修改的磁盘对账、移动端弹层定位、iPad 工具栏图标与窄屏公式联想等。\n\n笔记与关联仍然只是保存在本地的 Markdown 和 Obsidian 双链。",
      "zh-TW": "## 1.2.9 更新內容\n\n- **公式自動同步：** 計算欄位的結果可自動寫回筆記，支援按資料庫或全庫啟用。\n- **欄位重新命名事務化：** 重新命名屬性以單次可復原事務改寫所有受影響的筆記，完成後格式化顯示保留。\n- **關聯完整性：** 失效連結按「未找到 / 超出範圍」分別標識，檔案恢復後自動還原。\n- **可拖曳、可複製的視窗：** 所有外掛視窗可按標題旁的手柄拖曳，視窗與氣泡中的文字可選取複製。\n- **更強的 Bases 轉換：** 屬性清單支援搜尋與排序，.base 顯示名稱優先作為欄標題，公式屬性可選擇以計算欄位或文字匯入。\n- **穩定性修復：** 外部修改的磁碟對帳、行動端氣泡定位、iPad 工具列圖示與窄螢幕公式聯想等。\n\n筆記與關聯仍然只是儲存在本機的 Markdown 和 Obsidian 雙鏈。",
    },
  },
  {
    version: "1.2.8",
    notes: {
      en: "## What's new in 1.2.8\n\n- **Quick filter and sort chips:** see active rules in the toolbar, edit one in place, or remove it directly.\n- **Board record covers:** choose the image property, crop mode, and aspect ratio independently for each board view.\n- **Clearer formulas:** distinguish display names from frontmatter keys, preview substituted values, use `file.name` and `file.tags`, and recover with `IFERROR`.\n- **Relations and Rollups:** change the target database as one undoable operation and double-click a Rollup cell to configure it.\n- **Consistent editing:** use one new-property dialog, colored option group labels, native Page Preview, and improved date pickers.\n\nYour notes and relationships remain ordinary local Markdown and Obsidian wikilinks.",
      "zh-CN": "## 1.2.8 更新内容\n\n- **快捷筛选与排序：** 顶栏直接显示当前规则，可原地编辑一条或直接移除。\n- **看板记录封面：** 每个看板视图独立选择图片属性、裁切方式和宽高比。\n- **更清楚的公式：** 区分显示名称与 frontmatter 属性名，预览实际代入值，支持 `file.name`、`file.tags` 和 `IFERROR`。\n- **关联与汇总：** 切换目标数据库作为一次可撤销操作，双击 Rollup 单元格即可配置。\n- **统一编辑体验：** 新建属性窗口、选项分组彩色标签、原生 Page Preview 和日期选择器保持一致。\n\n笔记与关联仍然只是保存在本地的 Markdown 和 Obsidian 双链。",
      "zh-TW": "## 1.2.8 更新內容\n\n- **快速篩選與排序：** 頂欄直接顯示目前規則，可原地編輯一條或直接移除。\n- **看板記錄封面：** 每個看板檢視獨立選擇圖片屬性、裁切方式和長寬比。\n- **更清楚的公式：** 區分顯示名稱與 frontmatter 屬性名，預覽實際代入值，支援 `file.name`、`file.tags` 和 `IFERROR`。\n- **關聯與彙總：** 切換目標資料庫作為一次可復原操作，雙擊 Rollup 儲存格即可設定。\n- **統一編輯體驗：** 新增屬性視窗、選項分組彩色標籤、原生 Page Preview 和日期選擇器保持一致。\n\n筆記與關聯仍然只是儲存在本機的 Markdown 和 Obsidian 雙鏈。",
    },
  },
  {
    version: "1.2.6",
    notes: {
      en: "## What's new in 1.2.6\n\n- Add database cover images with adjustable vertical position for gallery views.\n- Add conditional formatting rules to highlight cells and cards based on property values.\n- Add group subtotals (count, sum, average) to board, gallery, list, and grouped table.\n- Add relation and rollup columns to aggregate data across linked databases.\n- Add board column creation with inline name input and color picker.\n- Improve table keyboard navigation with spreadsheet-style cell selection, clipboard transactions, and paste-to-create.\n- Speed up view rendering with incremental refresh coordination and record caching.\n- Protect against accidental record creation when a popover or editor is open.\n- Fix column insertion position, multi-select option rendering, and board viewport stability.",
      "zh-CN": "## 1.2.6 更新内容\n\n- 数据库支持配置封面图片，画廊视图可调整封面垂直位置。\n- 新增条件格式规则，根据属性值自动高亮单元格和卡片。\n- 看板、画廊、列表和分组表格支持分组小计（计数、求和、平均值）。\n- 新增关联列和汇总列，可跨数据库聚合关联数据。\n- 看板支持新建分组，内联输入名称并选择颜色。\n- 完善表格键盘导航：电子表格式单元格选择、剪贴板事务、粘贴越界自动创建。\n- 增量刷新协调与记录缓存，提升视图渲染速度。\n- 浮窗或编辑器打开时，点击新建入口不再误触发创建。\n- 修复列插入位置、多选选项渲染、看板视口稳定性。",
      "zh-TW": "## 1.2.6 更新內容\n\n- 資料庫支援設定封面圖片，畫廊檢視可調整封面垂直位置。\n- 新增條件格式規則，根據屬性值自動標示儲存格和卡片。\n- 看板、畫廊、列表和分組表格支援分組小計（計數、加總、平均值）。\n- 新增關聯列和彙總列，可跨資料庫彙總關聯資料。\n- 看板支援新增分組，內嵌輸入名稱並選擇顏色。\n- 完善表格鍵盤巡覽：電子表格式儲存格選擇、剪貼簿事務、貼上超出範圍自動建立。\n- 增量刷新協調與記錄快取，提升檢視呈現速度。\n- 浮窗或編輯器開啟時，點擊新增入口不再誤觸發建立。\n- 修復列插入位置、多選選項呈現、看板檢視穩定性。",
    },
  },
  {
    version: "1.2.5",
    notes: {
      en: "## What's new in 1.2.5\n\n- Create records that follow supported database and view source rules.\n- Edit a field across multiple records with native typed editors, impact previews, confirmation, rollback, and undo.\n- Automatically register new select, status, and multi-select values entered through plugin UI.\n- Add Emoji or Lucide icons to databases and records across card-based views.\n- Insert records above or below a visible row while preserving group context and manual order.\n- Improved live settings refresh, rendered Markdown column sizing, file fields, search focus, mobile layout, and interaction stability.",
      "zh-CN": "## 1.2.5 更新内容\n\n- 新建记录会遵循数据库和视图中可自动应用的来源规则。\n- 支持使用原生类型编辑器批量修改多条记录，并提供影响预览、风险确认、失败回滚和撤销。\n- 通过插件 UI 输入的单选、状态和多选新值会自动登记。\n- 数据库与记录支持 Emoji 或 Lucide 图标，并覆盖各类卡片视图。\n- 支持在可见记录上方或下方插入，同时保留分组上下文和手动顺序。\n- 改进设置实时刷新、Markdown 渲染列宽、文件字段、搜索聚焦、移动端布局和交互稳定性。",
      "zh-TW": "## 1.2.5 更新內容\n\n- 新建記錄會遵循資料庫和檢視中可自動套用的來源規則。\n- 支援使用原生類型編輯器批次修改多筆記錄，並提供影響預覽、風險確認、失敗回復和復原。\n- 透過外掛 UI 輸入的單選、狀態和多選新值會自動登記。\n- 資料庫與記錄支援 Emoji 或 Lucide 圖示，並涵蓋各類卡片檢視。\n- 支援在可見記錄上方或下方插入，同時保留分組內容和手動順序。\n- 改進設定即時刷新、Markdown 渲染欄寬、檔案欄位、搜尋聚焦、行動版版面和互動穩定性。",
    },
  },
];

/** semver 比较：a < b → -1；a > b → 1；相等 → 0。非数字段按 0 处理。 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value.split(".").map((part) => Number(part) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function resolveNotesLocale(locale: ReleaseNotesLocale): "en" | "zh-CN" | "zh-TW" {
  return locale === "zh-CN" || locale === "zh-TW" ? locale : "en";
}

/**
 * 收集 (fromVersion, toVersion] 区间内的版本文案（新 → 旧排列，最新变化最醒目）。
 * - fromVersion 为空/无法识别（首次安装或极旧）：只返回 toVersion 单条；
 * - 区间内无收录文案（如 to 是尚未写文案的开发版）：回落到 <= toVersion 的最近一条，
 *   保持「弹窗总有内容」的旧行为。
 */
export function collectChangelogNotes(
  fromVersion: string | undefined,
  toVersion: string,
  locale: ReleaseNotesLocale,
): string[] {
  const notesLocale = resolveNotesLocale(locale);
  const pick = (entry: { notes: Partial<Record<"en" | "zh-CN" | "zh-TW", string>> }): string => entry.notes[notesLocale] || entry.notes.en || "";
  const collected: string[] = [];
  if (fromVersion && compareVersions(fromVersion, toVersion) < 0) {
    for (const entry of RELEASE_NOTES) {
      if (compareVersions(entry.version, toVersion) <= 0 && compareVersions(entry.version, fromVersion) > 0) {
        collected.push(pick(entry));
      }
    }
  }
  if (collected.length > 0) return collected;
  const fallback = RELEASE_NOTES.find((entry) => compareVersions(entry.version, toVersion) <= 0);
  return fallback ? [pick(fallback)] : [];
}

/** 拼接为单段 Markdown（各版文案自带「## 版本」标题，用分隔线隔开）。 */
export function buildChangelogMarkdown(
  fromVersion: string | undefined,
  toVersion: string,
  locale: ReleaseNotesLocale,
): string {
  return collectChangelogNotes(fromVersion, toVersion, locale).join("\n\n---\n\n");
}
