# Note Database

[English README](README.md)

为 Obsidian Markdown 笔记提供本地数据库视图。

Note Database 可以把 Markdown 文件和 frontmatter 属性组织成可编辑的表格、看板、画廊和列表视图。它保持本地优先，直接使用普通 Markdown 文件，并把数据库配置保存在你的 vault 中。

## 核心亮点

- **四种数据库视图**：同一组笔记可以在表格、看板、画廊和列表之间切换。
- **Markdown 优先存储**：每个数据库都保存为 vault 中普通的 `db_view: true` Markdown 文件。
- **直接编辑属性**：可以在视图中编辑文本、数字、日期、货币、复选框、单选、多选、状态和文件名。
- **灵活筛选与分组**：支持筛选、排序、分组、隐藏字段、标题字段、手动排序和每个视图独立的布局设置。
- **计算字段**：用字段引用、内置函数、实时预览和可选 frontmatter 同步来构建公式。
- **嵌入视图**：可以把只读数据库视图嵌入任意笔记，同时保留视图切换、筛选、排序、分组、显示字段和导出工具。
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

每个视图都可以保存自己的筛选、排序、分组、显示字段、标题字段和布局设置。

## 快速开始

点击左侧 ribbon 的数据库图标，或在命令面板中运行 `Note database: 打开面板`。你也可以通过命令面板导入数据、转换 `.base` 文件，或打开对应数据库文件。

![命令面板](assets/screenshots/zh-command-list.png)

创建数据库后，选择来源文件夹，再添加属性和视图。来源文件夹决定哪些 Markdown 笔记会被纳入数据库；视图设置决定这组笔记以什么方式呈现。

完整数据库界面的设置面板会区分“当前数据库”和“当前视图”：数据库设置负责名称、描述、来源文件夹和新建目录；视图设置负责标题字段、默认字段宽度、画廊封面、看板子组、状态预设等布局行为。

![设置面板](assets/screenshots/zh-settings-panel.png)

插件设置页用于配置全局选项，例如语言、默认数据库文件夹、全局状态预设、数据库文件、导入导出和插件回收站。

![插件设置](assets/screenshots/zh-settings.png)

## 嵌入视图

在完整数据库中右键视图标签，或从导出菜单复制当前视图的嵌入代码。

![复制到剪贴板](assets/screenshots/zh-copy-to-clipboard.png)

把代码粘贴到任意 Obsidian 笔记中，就可以得到一个只读的嵌入数据库视图。嵌入视图仍然保留视图切换、筛选、排序、分组、属性显示、计算字段和复制导出等工具栏能力。

![内嵌视图](assets/screenshots/zh-embed-view.png)

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

### 1.0.9

- 继续完善 1.0.8 之后的 Obsidian 插件审核兼容性与稳定性，包括更安全的图标渲染、计算字段复选框公式编辑、弹出窗口兼容、确认弹窗、Promise 处理、类型安全清理和 ZIP 导出 buffer 处理。

完整历史见 [GitHub Releases](https://github.com/pangy9/obsidian-note-database/releases)。
