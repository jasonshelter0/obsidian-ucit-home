# UCIT Home

An Obsidian plugin by **Jason Shelter** ([jasonshelter0](https://github.com/jasonshelter0)) for turning project notes into outcomes: plan work, track dependencies, record evidence, and close commitments deliberately.

The interface is currently Chinese. Your Markdown files remain the task ledger. No accounts, cloud service, shell execution or AI API are required.

## Install

Download `ucit-home.zip` from [Releases](https://github.com/jasonshelter0/obsidian-ucit-home/releases/latest), extract the `ucit-home` folder into your vault's `.obsidian/plugins/`, then enable **UCIT Home**. To update, replace `main.js`, `manifest.json` and `styles.css`; preserve your `data.json`.

Alternatively, add `jasonshelter0/obsidian-ucit-home` to [BRAT](https://github.com/TfTHacker/obsidian42-brat). The release includes the three individual plugin assets needed for installation. This plugin is not currently listed in Obsidian's community catalog.

Requires Obsidian 1.5.0 or newer. New Calendar Suite is optional. No build step is required for the runtime plugin.

## Features

- PAWSC board: **planned / active / waiting / suspended / closed**.
- Create task notes in their own folders with automatically allocated IDs.
- Edit next actions, acceptance criteria, dependencies, review dates and scheduled effort.
- Closure requires evidence or a recorded cancellation/merge decision; reopening cannot invalidate active dependent work.
- Project progress separates successful completion from other closure reasons.
- Day, week, month and NC period agendas; search and project/area/status filters.
- Daily capacity comparison using `scheduled_on` and `estimate_hours`.
- Stale-edit protection and an appended decision/change history.
- Live `ucit` Markdown blocks in periodic notes.

## Start with one project

UCIT indexes Markdown under `projects/` with `ucit_version: 2` and `kind: project` or `task`. It does not infer current work from legacy codes or ordinary notes.

Create `projects/DEMO-001/HOME.md`:

```yaml
---
ucit_version: 2
kind: project
ucit: DEMO-001
area: '[[Work]]'
status: planned
goal: Build one useful prototype
outcome: A working prototype with a demonstrated use case
next_action: Specify the first acceptance test
review_on: '2027-01-04'
budget: 4 hours this week
task_source: projects/DEMO-001/tasks
---
# Prototype
```

Run **UCIT Home: 打开今日主页**, then use **＋ 子任务**. A task such as `DEMO-001-T001` is created under `projects/DEMO-001/tasks/DEMO-001-T001/`. The project must be active before its task can become active.

Use **调整 / 闭环** to edit a task. Set `scheduled_on` to the intended work date and `estimate_hours` to effort reserved on that date. These fields are plans, not time tracking. `due` remains the target delivery date; `review_on` is the next commitment review. Each task currently has one scheduled date.

The default standalone plan folders are `areas/periodicNotes/daily`, `areas/periodicNotes/weekly`, and `areas/periodicNotes/gc-monthly`; they are configurable. The optional Markdown homepage path is also configurable. Daily capacity defaults to 8 hours and timezone to Asia/Shanghai.

## New Calendar Suite integration

Designed against [New Calendar Suite 1.4.5](https://github.com/jasonshelter0/obsidian-new-calendar-suite), also by Jason Shelter. Enable both plugins and the UCIT **连接 New Calendar Suite** setting.

1. **Shared note creation.** UCIT's day/week/month buttons delegate to NCS's existing calendar view methods. NCS supplies folders, filename formats, templates and its creation behavior. UCIT does not silently create a second fallback note if the bridge fails.
2. **Shared week boundaries.** UCIT uses NCS's configured Moment locale/week start. Without NCS, standalone weeks use ISO Monday-based boundaries.
3. **NC periods.** Open or inspect NC phase, month, season and year periods using `window.NCNotes` and `window.NCDates`. UCIT task dates stay Gregorian `YYYY-MM-DD`. NC ranges follow NCS's inclusive end dates.
4. **Calendar markers.** The `calendar:open` source hook adds red deadline/overdue, blue scheduled-work, amber review and green successfully-completed markers to the GC and NC calendars. These supplement NCS's existing dots. A marker shows that a category exists, not an exact task count.
5. **Periodic note panels.** Place a live block in daily, weekly, monthly or NC notes to see linked tasks and update them without copying their state.
6. **Selected dates.** The dashboard date picker and agenda buttons open notes or prefill new tasks for that date. Commands can open the dashboard or create a task from the currently open periodic note.

UCIT reconnects existing calendar panes once on startup through Obsidian's leaf lifecycle so that previously mounted calendars receive the source. This preserves pane placement but can reset calendar navigation to the current month. You can also run **UCIT Home: 连接 GC / NC 日历标记**. On unload, UCIT removes its source. NCS plugin files and settings are not patched.

GC navigation currently depends on feature-detected NCS view methods; a future NCS release may change them. An incompatible bridge reports an error rather than bypassing NCS. Templater processing remains governed by your existing NCS/Templater setup; UCIT does not evaluate template code itself.

### Embed live tasks

In a periodic note whose frontmatter or filename identifies its date:

````markdown
```ucit
period: auto
```
````

Or specify the date and period explicitly:

````markdown
```ucit
period: week
date: 2027-01-04
project: DEMO-001
show_closed: false
```
````

Supported periods: `day`, `week`, `month`, `nc-phase`, `nc-month`, `nc-season`, `nc-year`. Omit `project` to include all projects. The live panel includes in-period scheduled/due/review dates, open earlier commitments and active/waiting work. It is a current operational view, not a historical snapshot. It renders in Reading view and rendered Live Preview blocks; source mode shows the code.

Auto detection understands `gc-type: daily/weekly/monthly`, NCS `nc-type: phase/month/season/year`, `date`, `gc-date`, and configured filenames. Ambiguous ordinary notes need an explicit period/date.

## Data and write behavior

- Evidence presence is validated; the plugin cannot judge whether a claim is true or the artifact meets your acceptance criteria.
- Dependencies are satisfied only by `closed` with `resolution: done`.
- Existing note bodies and unknown properties are preserved, but YAML formatting/comments may change when serialized.
- Creation reserves ID high-water marks in plugin `data.json`. Keep this file when syncing or migrating. Completely deleted historical IDs without any surviving reservation cannot be reconstructed.
- Writes are serialized within one plugin instance. The target note is checked against the editor's original contents and updated through `Vault.process`. There is no cross-device transaction or shared lock with external scripts; use one writer for related tasks at a time.
- This plugin does not execute commands from notes, start experiments, or run autonomous research.

## Development

```bash
npm ci
npm run check
npm test
npm run package
```

Tests use real YAML and Moment libraries with an in-memory Obsidian API/DOM. An optional `UCIT_TEST_FIXTURES` path enables a read-only local-vault validation case; no personal fixture is included in this repository. A mocked UI test does not replace checking actual Obsidian rendering, especially on mobile.

`npm run package` writes an allowlisted release to `dist/`: individual runtime assets, `ucit-home.zip`, and `SHA256SUMS`. It does not package the source checkout, tests, dependencies or local settings.

Workflow templates are provided in `examples/workflows/`. They are not active: the publishing credential does not have GitHub workflow permission. To enable automated CI and tag releases later, install them under `.github/workflows/` using a workflow-capable credential. This release was tested and packaged locally, then uploaded directly. Version tags match `manifest.json` without a `v` prefix for plugin updater compatibility.

## License

MIT. Copyright © 2026 Jason Shelter.
