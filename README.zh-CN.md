# Note Database

[English README](README.md)

Note Database 是一个面向 Obsidian 笔记的本地数据库视图插件。它把 Markdown 文件和 frontmatter 组织成可编辑、可筛选、可分组、可嵌入的数据库，让一组笔记既能保持 Markdown 的开放格式，又能拥有接近工作台的结构化管理体验。

适合用来管理项目、阅读计划、订阅清单、内容库、任务流、资料索引、课程/研究笔记，以及任何需要把笔记按属性组织起来的场景。

![表格视图](assets/screenshots/zh-table-view.png)

## 1.0.7 更新亮点

1.0.7 是一个 hotfix，主要修复数据安全与新用户首屏体验：

- 打开无关 Markdown 文件时，不再触发计算字段写回。
- 刷新计算字段时会兼容旧版视图级来源文件夹，不再意外扩大到整个 vault。
- 删除属性后，重启 Obsidian 不会再把旧列恢复回来。
- 空 Dashboard 现在会显示居中的首个数据库创建按钮，不再显示渲染错误。
- CSV + Markdown ZIP 导出现在可以选择输出位置，并在完成后提示实际保存路径。

## 1.0.5 更新亮点（相较于 1.0.4）

- **数据库统一为 Markdown 文件存储**：所有数据库现在都保存为普通的 `db_view: true` Markdown 文件。旧版本保存在插件设置中的数据库会在加载时自动迁移。
- **四种视图共享手动排序**：表格行、看板卡片、画廊卡片和列表条目使用 LexoRank-like 视图内顺序。桌面端可以精确拖拽到目标位置；显式属性排序仍然优先。
- **手机端手动排序菜单**：手机端不依赖自由拖拽。表格、画廊和列表支持上移、下移、置顶、置底与跨分组移动；看板还支持移动到指定卡片前后。
- **计算字段精准同步**：计算结果会在相关保存事件发生时更新，不再依赖定时全量刷新，减少不必要的计算。
- **更顺滑的属性编辑**：普通属性和卡片复选框会尽量进行乐观局部更新，写回 Markdown frontmatter 时减少整个视图闪烁。
- **更完整的新建数据库流程**：创建数据库时可以扫描现有 frontmatter，并在属性确认窗口中选择需要导入的字段；创建后会立即打开新数据库。
- **分组和文件导航优化**：自定义分组顺序改为即时保存 popover；数据库文件在文件列表中显示 `DB` 标记；文件名字段悬停时可展开文件夹路径前缀。
- **交互细节打磨**：日期编辑统一为 contextual popover；横向滚动更容易发现；宽列表中新建条目后会从最左侧内容开始显示。

## 核心亮点

- **四种数据库视图**：同一组笔记可以切换为表格、看板、画廊和列表。每个数据库最多支持 15 个视图，每个视图都可以保存自己的筛选、排序、分组、显示属性、标题字段和布局设置。
- **直接编辑笔记属性**：支持文本、数字、日期、货币、复选框、单选、多选、状态和文件名内联编辑。修改会写回 Markdown frontmatter，文件名列也可以直接触发重命名。
- **完整的属性管理**：支持新增、重命名、修改 key、修改类型、隐藏/显示、列宽调整、列顺序拖拽、选项颜色和状态预设管理，并会同步 Obsidian 属性类型。
- **更强的筛选、排序、分组**：支持 AND/OR 多条件筛选、类型感知排序、表格分组、看板分组、看板子组、分组折叠、自定义分组顺序和批量选择。
- **计算字段 / 公式**：公式编辑器支持字段引用、常用函数、语法高亮、实时结果、引用字段值和逐步计算预览；每个数据库可以选择仅展示计算结果、自动写回 frontmatter，或仅在手动同步后写回。
- **嵌入任意笔记**：可以把数据库视图嵌入到普通 Markdown 笔记中。嵌入视图保持记录只读，但可以同步筛选、排序、分组、属性显示等视图配置。
- **Markdown 数据库文件**：每个数据库配置都保存在普通的 `db_view: true` Markdown 文件中，可以和笔记一样整理、打开和管理。
- **导入导出与迁移**：支持 CSV + Markdown ZIP 导入导出，可选择是否在导出的 Markdown 文件中包含 frontmatter 字段，也支持从 Obsidian `.base` 文件转换为 Note Database 数据库。
- **本地优先与多语言**：插件在 Obsidian 内本地运行，不上传 vault 内容、metadata、公式或设置。界面支持跟随系统、English、简体中文和繁體中文。

## 多视图展示

表格视图适合处理结构化数据、批量查看字段、快速编辑属性和使用列头排序。

![表格视图](assets/screenshots/zh-table-view.png)

看板视图适合任务状态、流程阶段、阅读进度等按状态推进的场景。看板支持分组列、子组、卡片字段显示、批量选择和分组顺序调整。

![状态看板](assets/screenshots/zh-status-board.png)

画廊视图适合阅读计划、图片资料、作品集、卡片式内容库等视觉浏览场景。可以设置封面字段、卡片宽度、图片比例和显示属性。

![画廊视图](assets/screenshots/zh-gallery-view.png)

列表视图适合需要更紧凑浏览的资料目录、待办清单和轻量索引。它保留属性展示和分组能力，同时比画廊更节省空间。

![列表视图](assets/screenshots/zh-list-view.png)

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

计算字段支持 `[字段名]` 这样的方括号引用，也支持 `field(name)` 引用字段。公式基于 JavaScript 表达式求值，并提供一组适合笔记数据库的内置函数。

常用函数示例：

| 函数 | 说明 |
| --- | --- |
| `today()` | 当前日期 |
| `now()` | 当前日期和时间 |
| `days(dateA, dateB)` | 计算两个日期之间的天数 |
| `daysFromNow(date)` | 计算某日期距离今天的天数 |
| `addMonths(date, n)` | 给日期增加 n 个月 |
| `addYears(date, n)` | 给日期增加 n 年 |
| `round(n, d)` | 四舍五入 |
| `floor(n)`, `ceil(n)` | 数学取整函数 |
| `max(a, b)`, `min(a, b)` | 比较大小 |
| `concat(a, b, ...)` | 拼接文本 |
| `if(condition, thenValue, elseValue)` | 条件判断 |

公式编辑器会显示可用字段、函数列表、示例、实时预览、引用字段值和逐步替换过程，避免用户在一个大文本框里盲写公式。右上角还提供复制 AI 提示词的入口，方便把当前字段、函数和公式草稿发给任意 AI 辅助修改。

打开数据库视图时，计算值始终会刷新用于展示。你可以在数据库设置中选择仅展示的虚拟属性、不写回 frontmatter；自动写回；或者只在点击手动同步按钮后写回。

![公式编辑器](assets/screenshots/zh-formula-editor.png)

## 导入导出

Note Database 支持把当前数据库导出为 CSV + Markdown ZIP，也支持再导入这种格式。导出时可以选择 ZIP 保存位置，也可以选择是否把 frontmatter 字段写入 Markdown 文件，ZIP 内还会包含数据库元数据，方便在重新导入时尽量恢复属性、视图和配置结构。

如果导入的 CSV + Markdown 文件没有包含数据库元数据，插件会根据 CSV 内容推断字段类型，并在导入前弹出确认界面，让你检查日期、数字、复选框、单选、多选、状态等字段类型。

工具栏的导出菜单还可以把当前视图复制为嵌入代码、CSV 或 Markdown 表格。

![复制到剪贴板](assets/screenshots/zh-copy-to-clipboard.png)

## `.base` 文件转换

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

## 开发

```bash
npm install
npm run dev
npm run build
```

## 隐私

Note Database 完全在 Obsidian 本地运行。它不会把 vault 内容、metadata、公式或设置发送到任何外部服务。详情见 [PRIVACY.md](PRIVACY.md)。

## 支持与打赏

如果 Note Database 帮到了你，欢迎 star 或通过下面的链接支持后续开发：

<a href="https://paypal.me/pangy9">
  <img src="https://img.shields.io/badge/PayPal-打赏支持-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="通过 PayPal 打赏支持">
</a>

<img src="assets/screenshots/wechat_sponsor.jpg" width="300" alt="Sponsor on WeChat">

## 许可证

MIT
