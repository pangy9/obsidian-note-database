# Note Database

[简体中文说明](README.zh-CN.md)

Local database views for Markdown notes in Obsidian.

Note Database turns Markdown files and frontmatter properties into editable table, board, gallery, and list views. It stays local-first, works with plain Markdown files, and keeps database configuration inside your vault.

## Highlights

- **Four database views**: switch the same notes between table, board, gallery, and list layouts.
- **Markdown-first storage**: every database is saved as a normal `db_view: true` Markdown file in your vault.
- **Inline property editing**: edit text, numbers, dates, currency, checkboxes, selects, multi-selects, statuses, and file names directly from the view.
- **Flexible filtering and grouping**: combine filters, sorting, grouping, hidden fields, title fields, manual order, and per-view layout settings.
- **Computed fields**: build formulas with field references, helper functions, live previews, and optional frontmatter sync.
- **Embedded views**: embed read-only database views inside any note while keeping view switching, filters, sorting, grouping, visible fields, and export tools available.
- **Import, export, and Bases conversion**: move data with CSV + Markdown ZIP files or convert Obsidian `.base` files.
- **Local and private**: vault content, metadata, formulas, and settings stay on your device.

## Views

| Table | Board |
| --- | --- |
| ![Table view](assets/screenshots/en-table-view.png) | ![Board view](assets/screenshots/en-status-board.png) |
| Dense property editing, column sorting, grouping, batch selection, resizing, and structured review. | Status-driven workflows with grouped columns, subgroups, card fields, manual ordering, and drag-and-drop updates. |

| Gallery | List |
| --- | --- |
| ![Gallery view](assets/screenshots/en-gallery-view.png) | ![List view](assets/screenshots/en-list-view.png) |
| Visual browsing for reading plans, references, portfolios, and card-style content libraries. | Compact indexes for tasks, directories, research notes, and long lists that need fast scanning. |

Each view can keep its own filters, sorting, grouping, visible fields, title field, and layout settings.

## Getting Started

Click the database icon in the left ribbon, or run `Note database: Open dashboard` from the command palette. The command palette can also import data, convert `.base` files, or open the corresponding database file.

![Command palette](assets/screenshots/en-command-list.png)

After creating a database, choose a source folder, then add properties and views. The source folder decides which Markdown notes belong to the database; view settings decide how those notes are presented.

The dashboard settings panel separates "Current database" and "Current view": database settings cover the name, description, source folder, and new-note folder; view settings cover the title field, default field width, gallery cover, board subgroup, status presets, and layout behavior.

![Settings panel](assets/screenshots/en-settings-panel.png)

The plugin settings page manages global options such as language, the default database-file folder, global status presets, database files, import/export, and the plugin trash.

![Plugin settings](assets/screenshots/en-settings.png)

## Embedded Views

Right-click a view tab in the full dashboard, or use the export menu to copy the current view's embed code.

![Copy to clipboard](assets/screenshots/en-copy-to-clipboard.png)

Paste the code into any Obsidian note to get a read-only embedded database view. Embedded views still include view switching, filters, sorting, grouping, visible properties, computed fields, and copy/export tools.

![Embedded view](assets/screenshots/en-embed-view.png)

Embed code example:

~~~markdown
```note-database
dbPath: database/Example.md
viewId: mh2g9dz3_abcd123
```
~~~

Every database configuration is saved as a Markdown file with `db_view: true`, with its configuration stored in the frontmatter `database` object. Existing settings-based databases from earlier versions are migrated automatically.

![Open the corresponding database file](assets/screenshots/en-generate-or-open-database-file.png)

## Computed Fields And Formulas

Computed fields support bracket references such as `[Property name]`. Direct variable names and `field("field_key")` are also supported for compatibility, but bracket references are the recommended format. Formulas use safe expression evaluation with built-in helpers for note databases.

Common helpers:

| Function | Description |
| --- | --- |
| `TODAY()` | Current date |
| `NOW()` | Current date and time |
| `DAYS(start_date, end_date)` | Days between two dates |
| `DAYSFROMNOW(date)` | Days from today |
| `ADDDAYS(date, days)` | Add days to a date |
| `DATEADD(date, amount, "days")` | Add days, weeks, months, or years to a date |
| `ROUND(number, digits)` | Round a number |
| `FLOOR(number)`, `CEILING(number)` | Math rounding helpers |
| `MAX(a, b, ...)`, `MIN(a, b, ...)` | Compare values |
| `CONCAT(text1, text2, ...)` | Join text |
| `IF(condition, trueValue, falseValue)` | Conditional logic |

The formula editor shows available fields, function lists, examples, live preview results, referenced values, and step-by-step substitutions, so users do not have to write formulas in a blank textarea. It also includes a copyable AI prompt helper for sending the current formula draft, fields, and function context to an assistant.

Computed values refresh for display whenever a database view is opened. In the database settings, choose whether those values remain display-only virtual properties, are written back to frontmatter automatically, or are written back only when you click the manual sync button.

![Formula editor](assets/screenshots/en-formula-editor.png)

## Import, Export, And Bases

Note Database can export the current database as a CSV + Markdown ZIP, and import the same format back. Export lets you choose the ZIP location, can optionally include frontmatter in the Markdown files, and the ZIP also includes database metadata to help restore properties, views, and configuration on re-import.

If imported CSV + Markdown files do not include database metadata, the plugin infers property types from CSV content and opens a confirmation dialog so you can review dates, numbers, checkboxes, select, multi-select, status fields, and other types before import.

The toolbar export menu can also copy the current view as embed code, CSV, or a Markdown table.

![Copy to clipboard](assets/screenshots/en-copy-to-clipboard.png)

If you already use Obsidian Bases, you can convert the current `.base` file into a Note Database database from the command palette. Conversion tries to preserve source rules, column order, column widths, sorting, grouping, and cards/list view information.

Source filters are converted without flattening nested `AND`, `OR`, or `NOT` groups. Simple rules are editable as fields and operators; richer Bases filter statements are preserved as editable expression rules and evaluated with the built-in compatibility layer. Unsupported plugin-specific expressions are not silently simplified.

Before conversion finishes, the plugin opens a property confirmation dialog so you can review field types and adjust dates, numbers, checkboxes, select, multi-select, status fields, and other properties.

## Installation

### From Obsidian Community Plugins

1. Open Settings -> Community Plugins.
2. Search for `Note Database`.
3. Install and enable the plugin.

### Manual Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release.
2. Create `.obsidian/plugins/note-database/` in your vault.
3. Copy the three files into that folder.
4. Enable the plugin in Settings -> Community Plugins.

## Privacy

Note Database runs locally inside Obsidian. It does not send vault content, metadata, formulas, or settings to any external service. See [PRIVACY.md](PRIVACY.md).

## Support

If Note Database helps you, a star or donation helps support continued development:

<a href="https://paypal.me/pangy9">
  <img src="https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal">
</a>

<img src="assets/screenshots/wechat_sponsor.jpg" width="300" alt="Sponsor on WeChat">

## Changelog

### 1.0.9

- Improved Obsidian plugin review compatibility and stability after 1.0.8, including safer icon rendering, computed checkbox formula editing, popout-window compatibility, confirmation modals, Promise handling, type-safety cleanup, and ZIP export buffer handling.

See the [GitHub releases](https://github.com/pangy9/obsidian-note-database/releases) for full release history.
