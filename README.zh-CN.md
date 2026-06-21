# Note Database

[English README](README.md)

为 Obsidian Markdown 笔记提供本地数据库视图。

Note Database 可以把 Markdown 文件和 frontmatter 属性组织成可编辑的表格、看板、画廊、列表、图表、日历和时间线视图。它保持本地优先，直接使用普通 Markdown 文件，并把数据库配置保存在你的 vault 中。

## 核心亮点

- **七种数据库视图**：同一组笔记可以在表格、看板、画廊、列表、图表、日历和时间线之间切换。
- **Markdown 优先存储**：每个数据库都保存为 vault 中普通的 `db_view: true` Markdown 文件。
- **直接编辑属性**：可以在视图中编辑文本、数字、日期、货币、复选框、单选、多选、状态和文件名。
- **灵活筛选与分组**：支持筛选、排序、分组、隐藏字段、标题字段、手动排序和每个视图独立的布局设置。
- **图表视图**：把当前筛选后的记录可视化为柱状、折线、面积、环形、数字、堆叠、分组和混合图表。
- **日历和时间线视图**：用 date 和 datetime 属性安排月、周、日和长期时间线计划。
- **看板子组和拖拽反馈**：可以为看板列增加二级分组，并在拖拽时显示更清晰的目标反馈。
- **计算字段**：用字段引用、内置函数、实时预览和可选 frontmatter 同步来构建公式。
- **嵌入视图**：可以把只读数据库视图嵌入任意笔记，同时保留视图切换、筛选、排序、分组、显示字段和导出工具。
- **数据库文件 tab 控制**：可以选择数据库文件是否总是在新标签页打开，以及是否避免重复打开同一个数据库文件。
- **导入导出与 Bases 转换**：支持 CSV + Markdown ZIP 导入导出，也可以转换 Obsidian `.base` 文件。
- **本地与隐私**：vault 内容、metadata、公式和设置都保留在本机。

## 多视图展示

| 表格 | 看板 |
| --- | --- |
| ![表格视图](assets/screenshots/zh-table-view.png) | ![看板视图](assets/screenshots/zh-status-board.png) |
| 适合密集属性编辑、列排序、分组、批量选择、列宽调整和结构化检查。 | 适合按状态推进的任务流，支持分组列、子组、卡片字段、手动排序和拖拽更新。 |

| 画廊 | 列表 |
| --- | --- |
| ![画廊视图](assets/screenshots/zh-gallery-view.png) | ![列表视图](assets/screenshots/zh-list-view.png) |
| 适合阅读计划、图片资料、作品集和卡片式内容库等视觉浏览场景。 | 适合任务、目录、研究笔记和需要快速浏览的长列表。 |

| 图表 | 时间线 |
| --- | --- |
| ![图表视图](assets/screenshots/zh-chart-view.png) | ![时间线视图](assets/screenshots/zh-timeline-view.png) |
| 将当前搜索与筛选结果聚合成可配置图表，支持汇总、明细钻取、色板和导出。 | 适合短期精读和长期压缩概览，支持日、周、月、季尺度、分组、拖拽和 resize。 |

| 日历(月) | 日历(周) |
| --- | --- |
| ![日历月视图](assets/screenshots/zh-calendar-view-month.png) | ![日历周视图](assets/screenshots/zh-calendar-view-week.png) |
| 适合按月查看安排、跨日全天事件和多日计划，并支持直接拖拽或调整起止日期。 | 适合近程排期和具体时段安排，全天区与时间网格可以同时呈现 date 和 datetime 事件。 |

每个视图都可以保存自己的筛选、排序、分组、显示字段、标题字段和布局设置。

## 图表视图

图表视图使用当前数据库在搜索、筛选和结果数量限制之后的记录。它支持计数和数值聚合、日期和数字分桶、可见分组、累计序列、参考线、数据标签、图例和 PNG 导出。

点击图表中的柱子、点或扇区，可以先查看匹配记录，再决定是否应用为筛选条件。

![图表明细](assets/screenshots/zh-chart-drilldown.png)

汇总栏现在可以组合计数、数值、日期、复选框和唯一值等多种统计方式。

![汇总栏](assets/screenshots/zh-summary-bar.png)

## 日历和时间线视图

日历视图可以把 date 和 datetime 字段变成月、周、日三种日程视图。跨日事件会在格子中连续显示，全天事件可以拖拽移动或调整起止日期，周/日时间网格可以创建和编辑具体时段事件。

时间线视图更适合跨多天和长期范围的计划。日尺度用于 datetime 细节，周尺度用于近程精读，月尺度用于多日概览，季尺度用于长期压缩概览。事件可以分组、拖拽、调整范围，并用紧凑的范围标签查看起止时间。

## 快速开始

点击左侧 ribbon 的数据库图标，或在命令面板中运行 `Note database: 打开面板`。你也可以通过命令面板导入数据、转换 `.base` 文件，或打开对应数据库文件。

![命令面板](assets/screenshots/zh-command-list.png)

创建数据库后，选择来源文件夹，再添加属性和视图。来源文件夹决定哪些 Markdown 笔记会被纳入数据库；视图设置决定这组笔记以什么方式呈现。

完整数据库界面的设置面板会区分“当前数据库”和“当前视图”：数据库设置负责名称、描述、来源文件夹和新建目录；视图设置负责标题字段、默认字段宽度、画廊封面、看板子组、状态预设等布局行为。

![设置面板](assets/screenshots/zh-settings-panel.png)

插件设置页用于配置全局选项，例如语言、默认数据库文件夹、全局状态预设、数据库文件、导入导出和插件回收站。

![插件设置](assets/screenshots/zh-settings.png)

数据库文件的打开方式也可以在插件设置中调整：你可以让数据库文件总是在新标签页打开，也可以防止同一个数据库文件被重复打开，或按自己的 Obsidian 分栏习惯组合使用。这个策略会同时作用于 Dashboard 打开、文件管理器打开，以及拖拽/打开数据库文件的 fallback 路径。

## 嵌入视图

在完整数据库中右键视图标签，或从导出菜单复制当前视图的嵌入代码。

![复制到剪贴板](assets/screenshots/zh-copy-to-clipboard.png)

把代码粘贴到任意 Obsidian 笔记中，就可以得到一个只读的嵌入数据库视图。嵌入视图仍然保留视图切换、筛选、排序、分组、属性显示、计算字段和复制导出等工具栏能力。

![内嵌视图](assets/screenshots/zh-embed-view.png)

如果希望嵌入块省略数据库表头，并把区域尽量留给视图内容，可以使用嵌入块顶部的浮动切换按钮，或手动添加 `hideHeader: true`。

![隐藏表头的内嵌视图](assets/screenshots/zh-embed-headerless.png)

嵌入代码示例：

~~~markdown
```note-database
dbPath: database/Example.md
viewId: mh2g9dz3_abcd123
```
~~~

所有数据库配置现在都会保存为带有 `db_view: true` 的 Markdown 文件，并把配置存储在 frontmatter 的 `database` 对象中。旧版本中保存在插件设置里的数据库会自动迁移。

![打开对应数据库文件](assets/screenshots/zh-generate-or-open-database-file.png)

## 计算字段 / 公式

计算字段支持 `[字段名]` 这样的方括号引用。直接变量名和 `field("field_key")` 也会作为兼容形式保留，但推荐优先使用方括号写法。公式使用安全表达式求值，并提供一组适合笔记数据库的内置函数。

常用函数示例：

| 函数 | 说明 |
| --- | --- |
| `TODAY()` | 当前日期 |
| `NOW()` | 当前日期和时间 |
| `DAYS(start_date, end_date)` | 计算两个日期之间的天数 |
| `DAYSFROMNOW(date)` | 计算某日期距离今天的天数 |
| `ADDDAYS(date, days)` | 给日期增加指定天数 |
| `DATEADD(date, amount, "days")` | 按天、周、月或年增加日期 |
| `ROUND(number, digits)` | 四舍五入 |
| `FLOOR(number)`, `CEILING(number)` | 数学取整函数 |
| `MAX(a, b, ...)`, `MIN(a, b, ...)` | 比较大小 |
| `CONCAT(text1, text2, ...)` | 拼接文本 |
| `IF(condition, trueValue, falseValue)` | 条件判断 |

公式编辑器会显示可用字段、函数列表、示例、实时预览、引用字段值和逐步替换过程，避免用户在一个大文本框里盲写公式。右上角还提供复制 AI 提示词的入口，方便把当前字段、函数和公式草稿发给任意 AI 辅助修改。

打开数据库视图时，计算值始终会刷新用于展示。你可以在数据库设置中选择仅展示的虚拟属性、不写回 frontmatter；自动写回；或者只在点击手动同步按钮后写回。

![公式编辑器](assets/screenshots/zh-formula-editor.png)

如果你曾经把计算结果保存进笔记 frontmatter，后来又决定只在数据库中显示，可以使用清理入口，从当前数据库范围内的笔记中删除已保存的计算属性。

![清理计算字段属性](assets/screenshots/zh-computed-cleanup.png)

## 文件元数据字段

`file.name`、`file.tags`、`file.links`、`file.folder` 和文件时间等内置字段会被视为文件元数据，而不是普通 frontmatter 属性。`file.name` 可以重命名笔记，`file.tags` 可以更新 frontmatter tags，只读文件元数据会被保护，避免误写入。

![文件元数据字段](assets/screenshots/zh-file-fields.png)

## 导入导出与 .base 转换

Note Database 支持把当前数据库导出为 CSV + Markdown ZIP，也支持再导入这种格式。导出时可以选择 ZIP 保存位置，也可以选择是否把 frontmatter 字段写入 Markdown 文件，ZIP 内还会包含数据库元数据，方便在重新导入时尽量恢复属性、视图和配置结构。

如果导入的 CSV + Markdown 文件没有包含数据库元数据，插件会根据 CSV 内容推断字段类型，并在导入前弹出确认界面，让你检查日期、数字、复选框、单选、多选、状态等字段类型。

工具栏的导出菜单还可以把当前视图复制为嵌入代码、CSV 或 Markdown 表格。

![复制到剪贴板](assets/screenshots/zh-copy-to-clipboard.png)

如果你已经使用了 Obsidian Bases，可以通过命令面板把当前 `.base` 文件转换为 Note Database 数据库。转换会尽量保留来源规则、列顺序、列宽、排序、分组，以及 cards/list 视图信息。

来源筛选会保留嵌套的 `AND`、`OR` 和 `NOT` 结构，不会被压平成近似规则。简单规则会以字段和操作符形式编辑；更完整的 Bases 筛选语句会保留为可编辑的表达式规则，并通过内置兼容层执行。插件扩展等无法支持的表达式不会被静默简化。

转换后会弹出属性确认界面，你可以在导入前检查字段类型，把日期、数字、复选框、单选、多选、状态等字段调整到合适类型。

## 安装

### 从 Obsidian 社区插件市场安装

1. 打开 Settings -> Community Plugins。
2. 搜索 `Note Database`。
3. 安装并启用插件。

### 手动安装

1. 从最新 release 下载 `main.js`、`styles.css` 和 `manifest.json`。
2. 在 vault 中创建 `.obsidian/plugins/note-database/` 文件夹。
3. 把三个文件复制进去。
4. 在 Settings -> Community Plugins 中启用插件。

## 隐私

Note Database 完全在 Obsidian 本地运行。它不会把 vault 内容、metadata、公式或设置发送到任何外部服务。详情见 [PRIVACY.md](PRIVACY.md)。

## 支持与打赏

如果 Note Database 帮到了你，欢迎 star 或通过下面的链接支持后续开发：

<a href="https://paypal.me/pangy9">
  <img src="https://img.shields.io/badge/PayPal-打赏支持-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="通过 PayPal 打赏支持">
</a>

<img src="assets/screenshots/wechat_sponsor.jpg" width="300" alt="Sponsor on WeChat">

## 更新记录

### 1.2.0

- 新增日历和时间线视图，支持基于 date / datetime 属性的月、周、日、日尺度时间线、周/月/季时间线。
- 改进日期和日期时间处理，包括本地化显示、datetime 公式、跨日标签、无效区间检测和修复提示。
- 打磨日历和时间线交互，包括拖拽、resize、当前范围高亮、迷你日历跳转、裁切事件 fade 和响应式时间线窗口。
- 修复日历和时间线按天拖拽 datetime 事件时丢失具体时刻的问题。
- 改进看板视图中，卡片、分组、行和时间线事件的拖拽反馈。
- 改进嵌入视图刷新行为，避免数据库嵌入块刷新时把正在编辑的 Markdown 笔记滚回嵌入区域。

### 1.1.0

- 新增图表视图，支持柱状、水平柱状、折线、面积、环形、数字、堆叠、分组、百分比堆叠和混合图。
- 新增图表设置、图表汇总、可见分组、色板、参考线、明细钻取，以及 PNG 导出/复制。
- 汇总栏扩展为总和、数值、日期、复选框、唯一值、空值和已填写等多种统计方式。
- 新增受保护的文件元数据字段，包括可编辑的 `file.name`、`file.tags`、可点击文件链接和只读元数据防护。
- 新增计算字段 frontmatter 清理入口，方便移除曾经写入笔记属性区的计算结果。
- 新增数据库文件 tab 控制，可以设置总是在新标签页打开数据库文件，以及避免重复打开同一个数据库文件。
- 改进嵌入视图、共享下拉菜单、来源规则、拖拽反馈、选项编辑和发布前 UI 细节。

### 1.0.9

- 继续完善 1.0.8 之后的 Obsidian 插件审核兼容性与稳定性，包括更安全的图标渲染、计算字段复选框公式编辑、弹出窗口兼容、确认弹窗、Promise 处理、类型安全清理和 ZIP 导出 buffer 处理。

完整历史见 [GitHub Releases](https://github.com/pangy9/obsidian-note-database/releases)。
