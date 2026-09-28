# Note Database

<p align="center">
  <a href="README.md">English</a>
</p>

<p align="center">
  <strong>把 Markdown 笔记变成可以直接编辑、组织和计算的本地数据库。</strong><br>
  同一批笔记，八种视图，依然只是 Markdown。
</p>

<p align="center">
  <a href="obsidian://show-plugin?id=note-database"><img alt="在 Obsidian 中安装 Note Database" src="https://img.shields.io/static/v1?style=for-the-badge&amp;label=安装&amp;message=Obsidian&amp;logo=obsidian&amp;logoColor=white&amp;labelColor=363A4F&amp;color=7C3AED"></a>
  <a href="https://github.com/pangy9/obsidian-note-database"><img alt="GitHub Star 数量" src="https://img.shields.io/github/stars/pangy9/obsidian-note-database?style=for-the-badge&amp;label=Stars&amp;logo=github&amp;logoColor=white&amp;labelColor=363A4F&amp;color=E3B341"></a>
  <a href="https://obsidian.md/plugins?id=note-database"><img alt="Obsidian 社区下载量" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&amp;url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&amp;query=%24%5B%22note-database%22%5D.downloads&amp;label=下载量&amp;logo=obsidian&amp;logoColor=white&amp;labelColor=363A4F&amp;color=7C3AED"></a>
  <a href="https://github.com/pangy9/obsidian-note-database/releases/latest"><img alt="最新 GitHub 版本" src="https://img.shields.io/github/v/release/pangy9/obsidian-note-database?style=for-the-badge&amp;label=版本&amp;labelColor=363A4F&amp;color=0969DA"></a>
  <a href="LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/static/v1?style=for-the-badge&amp;label=许可证&amp;message=MIT&amp;labelColor=363A4F&amp;color=2DA44E"></a>
</p>

直接编辑 frontmatter，用多个视图查看同一批笔记，而所有记录仍留在你原来的 vault 中。

![包含快捷筛选、分组、小计、公式和文件属性的 Note Database](assets/screenshots/zh-1.2.7-overview.png)

## 功能亮点

- **八种数据库视图：** 用表格、看板、画廊、列表、图表、日历、时间线和表单查看同一批笔记。
- **本地表单采集：** 配置带必填字段和封面的表单视图，也可从其他视图或命令面板打开同款快速采集窗口；本次会话中保留未提交草稿。
- **数据库起步模板：** 从六种内置工作流开始，自动填好属性和视图，并可选择是否加入示例笔记。
- **Markdown 本地存储：** 数据库是带 `db_view: true` 的普通 Markdown 文件；记录、属性与关联也都保存在 vault 中。
- **直接编辑属性：** 不用逐篇打开笔记，即可编辑文本、数字、货币、日期、选项、状态、复选框和文件名；新建属性时统一确认显示名、属性名与类型。
- **电子表格式操作：** 支持键盘导航、范围选择、复制粘贴、填充、越界补行、批量编辑与一步撤销。
- **灵活组织记录：** 组合搜索、筛选、排序、分组、子组、手动顺序、快捷条件标签和结果限制。
- **来源感知的新建：** 按文件夹、标签、属性、链接或表达式界定记录，并在新建时保留来源与分组默认值、套用模板。
- **更直观的展示：** 使用数据库/记录图标、数据库/卡片封面、行内 Markdown、彩色选项、数字样式和条件格式。
- **小计与图表：** 汇总当前结果，在分组中显示多项小计，并从图表数值查看对应笔记。
- **公式、关联与汇总：** 安全计算属性，通过 Obsidian 双链关联笔记，再生成数量、总和、平均值或列表。
- **Obsidian 原生链接体验：** 使用 `file.*` 文件元数据，并通过核心 Page preview 预览记录标题、关联和文本中的内部链接。
- **日期规划：** 在月/周/日日历和日/周/月/季时间线中拖动、调整日期及时间范围。
- **内嵌与迁移：** 把数据库视图放进笔记（默认只读，可选择启用编辑），拖动调整内嵌高度，复制或导出数据，并转换 Obsidian `.base` 文件。
- **本地且私密：** 不建立云端数据副本，不把 vault 内容、metadata、公式或设置发送给外部服务。

## 同一批笔记，八种视图

数据库不复制笔记——八个视图只是同一批 Markdown 的不同透镜，每个视图都会保存自己的筛选、排序、分组、显示属性、标题属性和布局。

| 表格 | 看板 |
| --- | --- |
| ![表格视图](assets/screenshots/zh-1.2.7-overview.png) | ![看板视图](assets/screenshots/status-board.png) |
| 密集编辑、范围粘贴与填充、分组排序，以及键盘导航。 | 推进状态、使用子分组和封面，并通过拖拽调整记录。 |

| 画廊 | 列表 |
| --- | --- |
| ![画廊视图](assets/screenshots/gallery-view.png) | ![列表视图](assets/screenshots/list-view.png) |
| 用封面、属性、分组和小计浏览视觉内容库。 | 快速浏览任务、目录、研究笔记和高密度清单。 |

| 图表 | 时间线 |
| --- | --- |
| ![图表视图](assets/screenshots/chart-view.png) | ![时间线视图](assets/screenshots/timeline-view.png) |
| 把当前筛选结果转成图表、小计和明细，并导出 PNG。 | 在日、周、月、季尺度中规划，拖动或调整日期范围。 |

| 表单 |
| --- |
| ![带半页背景和必填字段的表单视图](assets/screenshots/zh-1.3.0-form-view.png) |
| 按属性类型录入新笔记，结合来源规则默认值与必填设置；封面可选横幅、半页背景或整页墙纸。 |

| 日历月视图 | 日历周视图 |
| --- | --- |
| ![日历月视图](assets/screenshots/calendar-view-month.png) | ![日历周视图](assets/screenshots/calendar-view-week.png) |
| 在月历中安排全天与跨日记录。 | 在细化的时间网格中处理全天和具体时段记录。 |

## 1.3.1 更新

- **桌面端右键排序：** 在表格、看板、画廊、列表与时间线中右键任意记录即可上移、下移、移动到指定位置，或进入点选模式把它放到任意记录前后；跨分组移动同样支持。
- **自定义数据库模板：** 把配置好的数据库保存为起步模板（可选包含当前视图至多 20 条示例记录），在同一 vault 新建数据库时直接复用；模板存放于 `Note Database Templates/`，可在预览中删除。
- **升级更全面的更新日志：** 跨多个版本升级时，弹窗会列出期间所有版本的更新内容。

## 从模板开始，或直接采集

六种内置起步模板预置好属性、视图、图标与封面，可再选择是否加入示例笔记；也可以把配置好的数据库保存为自己的模板。需要零散记录时，从任意视图或命令面板打开快速采集窗口，不离开当前位置即可提交。

| 快速采集窗口 | 数据库起步模板 |
| --- | --- |
| ![快速采集窗口](assets/screenshots/zh-1.3.0-quick-form.png) | ![内置数据库起步模板选择器](assets/screenshots/zh-1.3.0-starters.png) |
| 不离开当前视图即可打开表单；提交失败时保留已填内容。 | 选好工作流、预置属性与视图，并按需加入示例笔记，之后仍可自行修改。 |

## Obsidian 原生的链接预览

内部链接复用核心插件 Page preview，并遵循你设置的修饰键。

| 从记录链接打开页面预览 |
| --- |
| ![从记录链接打开 Obsidian Page Preview](assets/screenshots/zh-1.2.7-page-preview.png) |

需要先启用 Obsidian 核心插件 **Page preview（页面预览）**。支持记录标题、Relation 属性、可点击的 `file.*` 文件属性、设为 Link 显示模式的文本属性，以及行内 Markdown 文本/计算文本中的内部链接和 `[[双链]]`；Table、Board、Gallery、List、Calendar、Timeline、详情面板、数据库文件视图与内嵌视图使用同一套预览行为。


## 不用逐篇打开，也能批量编辑

属性编辑器支持文本、数字、货币、日期、复选框、单选、多选、状态和文件名。表格还支持范围选择、复制粘贴、填充、越界补行、安全改名和一步撤销。

| 类型化批量编辑 | 行内 Markdown 与数字样式 |
| --- | --- |
| ![同时修改多条记录的一个属性](assets/screenshots/zh-bulk-edit.png) | ![行内 Markdown 文本属性](assets/screenshots/markdown-number.png) |
| 先查看影响范围；风险写入需要确认，事务失败会回滚。 | 文本可显示为链接或行内 Markdown；数字可显示为评分、进度条或进度环。 |

| 统一的新建属性窗口 |
| --- |
| ![新建属性窗口](assets/screenshots/zh-1.2.7-new-property-dialog.png) |
| 所有入口都确认显示名称、frontmatter 属性名与属性类型。 |

## 筛选、着色与小计

| 条件格式 | 分组小计 |
| --- | --- |
| ![条件格式规则](assets/screenshots/zh-conditional-format.png) | ![带小计的分组](assets/screenshots/zh-board-groups-summaries.png) |
| 按当前视图的规则，为命中的属性或整条记录着色。 | 在分组视图中添加并排序计数、求和、平均值、最大/最小值等小计。 |

| 快捷筛选与排序标签 |
| --- |
| ![筛选与排序快捷条件标签](assets/screenshots/zh-1.2.7-facet-controls.png) |
| 顶栏直接显示当前规则；点开编辑一条，或直接移除。 |

快捷筛选与排序标签和工具栏完整面板使用同一套规则；也可以直接拖动记录建立手动顺序。来源规则可用 `AND`、`OR`、`NOT` 组合文件夹、标签、属性、链接和表达式。

## 计算，也让笔记彼此关联

| 计算属性 | 关联与汇总 |
| --- | --- |
| ![公式编辑器](assets/screenshots/zh-formula-editor.png) | ![关联笔记与 Rollup 结果](assets/screenshots/zh-relation-rollup.png) |
| 使用属性引用、日期/文本/数字函数、实时预览，以及可选的 frontmatter 同步。 | 用普通 Obsidian 双链保存关联，再计算数量、总和、平均值或列表。 |

公式编辑器区分显示名称与 frontmatter 属性名，预览实际代入值，并可用 `IFERROR` 处理空值或错误；关联保存为普通双链，切库清理可一步撤销，表格中双击即可配置 Rollup。插件不会使用 `eval`，也不会建立隐藏的关联数据库或云端副本。

## 让记录更容易辨认

| 数据库与记录图标 | 封面与视觉卡片 |
| --- | --- |
| ![数据库与记录图标](assets/screenshots/zh-database-icons.png) | ![数据库、看板与画廊封面](assets/screenshots/zh-dataset-covers-setting.png) ![](assets/screenshots/zh-board-covers-setting.png)|
| 使用 Unicode Emoji 或 Lucide 图标，并允许每个视图选择不同的记录图标属性。 | 拖动数据库封面调整位置；看板与画廊分别保存自己的封面设置。 |

| 看板记录封面 |
| --- |
| ![带记录封面的看板](assets/screenshots/zh-1.2.7-board-covers.png) |
| 每个看板独立选择封面属性、裁切方式和宽高比。 |

选项类分组标题在表格、看板、画廊和列表中保持相同颜色。搜索会高亮文件名、可见属性和本地化日期。

## 安排日期，查看结果

| 日历与时间线搜索 | 图表明细与小计 |
| --- | --- |
| ![日历与时间线搜索结果](assets/screenshots/zh-calendar-timeline-search-results.png) | ![图表明细](assets/screenshots/zh-chart-drilldown.png) |
| 搜索事件卡片中的可见字段，再拖动或调整 date / datetime 记录。 | 点击图表数值，先查看对应笔记，再决定是否加入筛选。 |

日历支持月、周、日；时间线支持日、周、月、季。

## 把数据库放进任意笔记

| 内嵌视图 | 隐藏表头的内嵌视图 |
| --- | --- |
| ![嵌入笔记中的数据库视图](assets/screenshots/zh-embed-view.png) | ![隐藏表头的紧凑内嵌视图](assets/screenshots/zh-embed-headerless.png) |
| 把自动生成的 `note-database` 代码块粘贴到任意笔记。 | 当笔记正文已经提供上下文时，可以隐藏数据库表头。 |

| 可编辑的内嵌视图 | 调整内嵌高度 |
| --- | --- |
| ![在内嵌数据库中编辑选中单元格](assets/screenshots/zh-1.3.0-editable-embed.png) | ![内嵌数据库高度拖动手柄](assets/screenshots/zh-1.3.0-embed-height.png) |
| 内嵌默认只读；在插件设置中启用编辑后，可直接在笔记中编辑记录。 | 拖动内嵌数据库的底边，为视图留出更多或更少空间。 |

内嵌数据库默认只读。在插件设置中关闭“内嵌数据库只读”后，可直接编辑笔记中的记录；表单内嵌也只有在可编辑模式下才能提交。拖动底边可调整高度。只读时仍可切换视图、筛选、排序、分组、查看计算值，以及使用复制和导出工具。

## Markdown 始终是数据源

| 内容 | 保存方式 |
| --- | --- |
| 数据库 | 带有 `db_view: true` 的普通 Markdown 文件 |
| 记录与属性值 | Markdown 笔记及其 frontmatter |
| 关联 | frontmatter 中的 Obsidian 双链 |
| 新记录模板 | Markdown、Obsidian Templates 或 Templater 文件 |
| 视图 | 保存在数据库文件中的配置 |

可以根据来源规则、分组、子组、当前行或表单新建记录，并在创建时套用新记录模板。也可导出 CSV + Markdown ZIP、复制 CSV / Markdown 表格，或转换 Obsidian `.base` 文件。

## 三步开始

1. 安装并启用 Note Database，从 ribbon 或命令面板打开数据库面板。
2. 新建空白数据库，或选择内置、已保存的起步模板，再设置文件夹或来源规则。
3. 添加属性与视图；编辑会写回原始 Markdown 文件。

![](assets/screenshots/zh-create-dataset.png)
![命令面板中的 Note Database 命令](assets/screenshots/zh-command-list.png)

在同一个 vault 内复用数据库配置时，打开数据库标题菜单，选择 **保存为起步模板…**。可填写名称、说明和图标，并选择是否包含当前视图的前 20 条记录。保存后，新建数据库的选择器中会出现 **我的模板**；模板文件存放于 `Note Database Templates/`，扩展名为 `.starter.json`。在预览中删除模板会将其移入回收站，不影响已创建的数据库。

模板保留属性、公式、视图与显示设置。新数据库使用独立标识和记录目录，重设来源规则、手动记录顺序及关联目标。图片和新记录模板继续引用当前 vault 的文件，缺失文件会在预览中提示。示例笔记会复制为新文件，不包含关联值和计算结果。

## 安装

1. 打开 **设置 → 第三方插件**。
2. 搜索 **Note Database**。
3. 安装并启用插件。

手动安装时，从[最新版本](https://github.com/pangy9/obsidian-note-database/releases/latest)下载 `main.js`、`styles.css` 和 `manifest.json`，复制到 `.obsidian/plugins/note-database/`。

## 隐私

Note Database 完全在 Obsidian 本地运行，不会把 vault 内容、metadata、公式或设置发送给外部服务。详情见[隐私说明](PRIVACY.md)。

## 支持与打赏

如果 Note Database 对你有帮助，可以给[仓库点一个 Star](https://github.com/pangy9/obsidian-note-database)，或支持后续开发：

<a href="https://paypal.me/pangy9">
  <img src="https://img.shields.io/badge/PayPal-打赏支持-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="通过 PayPal 打赏支持">
</a>

<img src="assets/screenshots/wechat_sponsor.jpg" width="220" alt="通过微信赞赏支持">

版本说明和完整更新历史见 [GitHub Releases](https://github.com/pangy9/obsidian-note-database/releases)。
