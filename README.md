# Note Database

<p align="center">
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Turn Markdown notes into editable, visual databases inside Obsidian.</strong><br>
  Same notes. Eight views. Still plain Markdown.
</p>

<p align="center">
  <a href="obsidian://show-plugin?id=note-database"><img alt="Install Note Database in Obsidian" src="https://img.shields.io/static/v1?style=for-the-badge&amp;label=Install&amp;message=Obsidian&amp;logo=obsidian&amp;logoColor=white&amp;labelColor=363A4F&amp;color=7C3AED"></a>
  <a href="https://github.com/pangy9/obsidian-note-database"><img alt="GitHub stars" src="https://img.shields.io/github/stars/pangy9/obsidian-note-database?style=for-the-badge&amp;label=Stars&amp;logo=github&amp;logoColor=white&amp;labelColor=363A4F&amp;color=E3B341"></a>
  <a href="https://obsidian.md/plugins?id=note-database"><img alt="Obsidian community downloads" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&amp;url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&amp;query=%24%5B%22note-database%22%5D.downloads&amp;label=Downloads&amp;logo=obsidian&amp;logoColor=white&amp;labelColor=363A4F&amp;color=7C3AED"></a>
  <a href="https://github.com/pangy9/obsidian-note-database/releases/latest"><img alt="Latest GitHub release" src="https://img.shields.io/github/v/release/pangy9/obsidian-note-database?style=for-the-badge&amp;label=Release&amp;labelColor=363A4F&amp;color=0969DA"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/static/v1?style=for-the-badge&amp;label=License&amp;message=MIT&amp;labelColor=363A4F&amp;color=2DA44E"></a>
</p>

Edit frontmatter in place, save several views of the same notes, and keep every record in the vault you already use.

![Note Database table with active filters, grouped records, summaries, formulas, and file properties](assets/screenshots/en-1.2.7-overview.png)

## Highlights

- **Eight database views:** see the same notes as a table, board, gallery, list, chart, calendar, timeline, or form.
- **Forms for local capture:** build a form view with required fields and a cover, or open the same quick-capture form from another view or the command palette. Unsubmitted drafts are kept during the current session.
- **Database starters:** begin with one of six built-in setups, each with properties and views; optionally add sample notes.
- **Local Markdown storage:** each database is an ordinary Markdown file with `db_view: true`; records, properties, and relations also stay inside your vault.
- **Direct property editing:** edit text, numbers, currency, dates, options, statuses, checkboxes, and file names without opening every note; one dialog confirms the display name, property key, and type for new properties.
- **Spreadsheet-style workflows:** use keyboard navigation, range selection, copy/paste, fill, paste-to-create, bulk editing, and single-step undo.
- **Flexible organization:** combine search, filters, sorting, groups, subgroups, manual order, quick facet chips, and result limits.
- **Source-aware creation:** select records by folder, tag, property, link, or expression, then preserve source/group defaults and apply templates when creating notes.
- **Visual presentation:** use database/record icons, database/card covers, inline Markdown, option colors, number styles, and conditional formatting.
- **Summaries and charts:** aggregate the current result, show several summaries in groups, and inspect the notes behind a chart value.
- **Formulas, Relations, and Rollups:** calculate properties safely, connect notes with Obsidian wikilinks, and derive count, sum, average, or list values.
- **Native Obsidian links:** use `file.*` metadata and the core Page preview plugin for record titles, Relations, and internal links inside text.
- **Date planning:** drag and resize date or time ranges in month/week/day calendars and day/week/month/quarter timelines.
- **Embedding and portability:** place database views in notes (read-only by default, with optional editing), resize the embedded block, copy or export data, and convert Obsidian `.base` files.
- **Local and private:** no cloud data copy and no external transmission of vault content, metadata, formulas, or settings.

## Eight views, one vault

A database never duplicates your notes — the eight views are just different lenses over the same Markdown, and each view keeps its own filters, sorting, grouping, visible properties, title property, and layout.

| Table | Board |
| --- | --- |
| ![Table view](assets/screenshots/en-1.2.7-overview.png) | ![Board view](assets/screenshots/status-board.png) |
| Edit dense records, paste ranges, fill cells, group, sort, and navigate by keyboard. | Move cards through stages, use subgroups, covers, colored options, and drag-and-drop. |

| Gallery | List |
| --- | --- |
| ![Gallery view](assets/screenshots/gallery-view.png) | ![List view](assets/screenshots/list-view.png) |
| Browse visual libraries with covers, properties, groups, and summaries. | Scan compact inventories, tasks, directories, and research notes. |

| Chart | Timeline |
| --- | --- |
| ![Chart view](assets/screenshots/chart-view.png) | ![Timeline view](assets/screenshots/timeline-view.png) |
| Turn the current filtered result into charts, summaries, drilldowns, and PNG exports. | Plan across day, week, month, or quarter scales; drag and resize date ranges. |

| Form |
| --- |
| ![Form view with half-page cover and required fields](assets/screenshots/en-1.3.0-form-view.png) |
| Capture a new note with field-aware controls, source-rule defaults, required fields, and a banner, half-page, or wallpaper cover. |

| Calendar month | Calendar week |
| --- | --- |
| ![Calendar month view](assets/screenshots/calendar-view-month.png) | ![Calendar week view](assets/screenshots/calendar-view-week.png) |
| Arrange all-day and multi-day records in a monthly overview. | Work with all-day and timed records on a detailed weekly grid. |

## New in 1.3.2

- **Frozen columns:** freeze up to five left-most properties from the column menu. While scrolling a wide table, the frozen columns, the checkbox column, the summary bar, and each group header's name, count, and summaries all stay in view. Available in the main view and editable embeds.
- **Fixes:** right-click "Insert above/below" works again; calendar and timeline option popovers no longer stop responding after the first change; embedded calendars keep column-width drags and month navigation.

## Start from a template, or capture on the go

Six built-in starters preset the properties, views, icons, and covers, with optional sample notes; save any configured database as your own template. For quick capture, open the dialog from any view or the command palette and submit without leaving where you are.

| Quick-capture dialog | Database starters |
| --- | --- |
| ![Quick capture dialog](assets/screenshots/en-1.3.0-quick-form.png) | ![Built-in database starter picker](assets/screenshots/en-1.3.0-starters.png) |
| Open a form without leaving the current view. A failed submission keeps the entered values. | Start with a workflow, its properties and views, and optional sample notes; then customize everything in your vault. |

## Native Obsidian link previews

Internal links reuse the core Page preview plugin and honor your modifier-key settings.

| Page preview opened from a record link |
| --- |
| ![Obsidian Page Preview opened from a record link](assets/screenshots/en-1.2.7-page-preview.png) |

Enable Obsidian's core **Page preview** plugin first. Preview works on record titles, Relation properties, clickable `file.*` metadata, text properties in Link display mode, and internal links or `[[wikilinks]]` in inline-Markdown text/computed-text properties. Table, Board, Gallery, List, Calendar, Timeline, the record detail panel, database-file views, and embedded views share the same behavior.


## Edit many notes without opening them

Field-aware editors cover text, numbers, currency, dates, checkboxes, selects, multi-selects, statuses, and file names. Table workflows include range selection, copy/paste, fill, overflow row creation, safe file renaming, and single-step undo.

| Typed bulk editing | Inline Markdown and number displays |
| --- | --- |
| ![Editing one property across several records](assets/screenshots/en-bulk-edit.png) | ![Inline Markdown and number display styles](assets/screenshots/markdown-number.png) |
| Preview the affected records, confirm risky writes, and roll back a failed transaction. | Render text as links or inline Markdown; show numbers as ratings, bars, or rings without changing stored values. |

| One new-property dialog |
| --- |
| ![New property dialog](assets/screenshots/en-1.2.7-new-property-dialog.png) |
| Confirm the display name, frontmatter key, and property type from every creation entry point. |

## Organize, highlight, and summarize

| Conditional formatting | Group summaries |
| --- | --- |
| ![Conditional formatting rules](assets/screenshots/en-conditional-format.png) | ![Board groups with summaries](assets/screenshots/en-board-groups-summaries.png) |
| Highlight a matching property or the whole record with view-specific rules. | Add and reorder count, sum, average, min/max, and other summaries in grouped views. |

| Quick filter and sort chips |
| --- |
| ![Active filter and sort facet chips](assets/screenshots/en-1.2.7-facet-controls.png) |
| See active rules as compact chips. Edit one rule in place or remove it directly. |

Active filter and sort chips use the same rules as the full toolbar panels, and records can also be dragged into a manual order. Source rules can combine folders, tags, properties, links, and expressions with `AND`, `OR`, and `NOT`.

## Wide tables keep their key columns in place

| Freeze up to this column | Still visible after scrolling |
| --- | --- |
| !["Freeze up to this column" in the column menu](assets/screenshots/en-1.3.2-freeze-menu.png) | ![Frozen columns and summaries pinned during horizontal scrolling](assets/screenshots/en-1.3.2-frozen-scrolled.png) |
| Pick "Freeze up to this column" from a header's context menu; up to five left-most properties. | Frozen columns, the checkbox column, the summary bar, and group headers stay visible while scrolling. |

Even at the far-right property, the names and totals you need stay on the left. Works in the main view and editable embeds; the checkbox column is always pinned, and freezing can be undone at any time.

## Calculate and connect

| Formulas | Relations and Rollups |
| --- | --- |
| ![Formula editor](assets/screenshots/en-formula-editor.png) | ![Linked notes and their Rollup result](assets/screenshots/en-relation-rollup.png) |
| Build computed properties with field references, date/text/number functions, live previews, and optional frontmatter sync. | Keep relationships as ordinary Obsidian wikilinks and calculate count, sum, average, or list values from linked notes. |

The formula editor distinguishes display names from frontmatter keys, previews substituted values, and recovers with `IFERROR`; relations are stored as plain wikilinks, target changes are one undoable step, and a table cell configures its Rollup on double-click. No `eval`, hidden relation database, or cloud copy is used.

## Make records easier to scan

| Database and record icons | Covers and visual cards |
| --- | --- |
| ![Database and record icons](assets/screenshots/en-database-icons.png) | ![Database, board, and gallery cover settings](assets/screenshots/en-dataset-covers-setting.png) ![](assets/screenshots/en-board-covers-setting.png) |
| Use Unicode Emoji or Lucide icons, with database defaults and per-view record-icon fields. | Add a draggable database cover and choose independent cover settings for board and gallery views. |

| Record covers on boards |
| --- |
| ![Board cards with record covers](assets/screenshots/en-1.2.7-board-covers.png) |
| Choose a cover property, crop mode, and ratio independently for every board view. |

Option-based group titles keep their colors across table, board, gallery, and list views. Search highlights file names and visible values, including localized dates.

## Plan dates and inspect results

| Search across Calendar and Timeline | Chart drilldown and summaries |
| --- | --- |
| ![Calendar and timeline search results](assets/screenshots/en-calendar-timeline-search-results.png) | ![Chart drilldown](assets/screenshots/en-chart-drilldown.png) |
| Search the fields visible on event cards, then drag or resize date and datetime records. | Click a chart value to inspect its records before applying a filter. |

Calendar supports month, week, and day. Timeline supports day, week, month, and quarter.

## Use database views anywhere

| Embedded view | Headerless embed |
| --- | --- |
| ![A database view embedded in a note](assets/screenshots/en-embed-view.png) | ![A compact headerless embedded view](assets/screenshots/en-embed-headerless.png) |
| Paste a generated `note-database` block into any note. | Hide the database header when the surrounding note already provides context. |

| Editable embed | Adjustable embed height |
| --- | --- |
| ![Editing a selected range in an embedded database](assets/screenshots/en-1.3.0-editable-embed.png) | ![Embedded database height grip](assets/screenshots/en-1.3.0-embed-height.png) |
| Embeds stay read-only by default. Enable editing in plugin settings to change records directly inside a note. | Drag the lower edge of an embedded database to give the view more or less room. |

Embedded databases are read-only by default. Disable **Read-only embedded databases** in plugin settings to allow editing in notes; form embeds can submit records only in this mode. Drag the lower edge to resize an embed. View switching, filters, sorting, grouping, computed values, and copy/export tools remain available in read-only mode. If a database explicitly enables automatic formula-result storage, that database-level background task still runs while the database is shown in an embedded view.

## Markdown remains the source of truth

| What | Stored as |
| --- | --- |
| Database | A normal Markdown file with `db_view: true` |
| Records and property values | Markdown notes and their frontmatter |
| Relations | Obsidian wikilinks in frontmatter |
| Record templates | Markdown, Obsidian Templates, or Templater files |
| Views | Saved configuration in the database file |

Create records from source rules, groups, subgroups, row insertion, or a form. Apply record templates at creation. Export CSV + Markdown ZIP, copy CSV/Markdown tables, or convert an Obsidian `.base` file.

## Start in three steps

1. Install and enable Note Database, then open the dashboard from the ribbon or command palette.
2. Create a blank database or choose a built-in or saved starter, then set its folder or source rules.
3. Add properties and views. Edits write back to the original Markdown files.

![](assets/screenshots/en-create-dataset.png)
![Note Database commands in the command palette](assets/screenshots/en-command-list.png)

To reuse a database setup in the same vault, open its title menu and choose **Save as starter template…**. Give it a name, description, and icon; optionally include up to 20 records from the current view. Saved templates appear under **My templates** when creating a database and are stored in `Note Database Templates/` as `.starter.json` files. Delete a template from its preview to move it to Trash without affecting existing databases.

Templates keep properties, formulas, views, and display settings. New databases receive fresh IDs and record folders; source rules, manual record order, and relation targets are reset. Images and new-record templates keep their vault references, and missing files are shown in the preview. Sample notes are copied; relation and computed values are excluded.

## Installation

1. Open **Settings → Community plugins**.
2. Search for **Note Database**.
3. Install and enable it.

For manual installation, download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/pangy9/obsidian-note-database/releases/latest) and copy them to `.obsidian/plugins/note-database/`.

## Privacy

Note Database runs locally in Obsidian. It does not send vault content, metadata, formulas, or settings to an external service. Read the full [privacy policy](PRIVACY.md).

## Support

If Note Database is useful to you, [star the repository](https://github.com/pangy9/obsidian-note-database) or support continued development:

<a href="https://paypal.me/pangy9">
  <img src="https://img.shields.io/badge/PayPal-Support-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Support through PayPal">
</a>

<img src="assets/screenshots/wechat_sponsor.jpg" width="220" alt="Sponsor on WeChat">

Release notes and the full change history are available on [GitHub Releases](https://github.com/pangy9/obsidian-note-database/releases).
