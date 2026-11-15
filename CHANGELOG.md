## 0.5.0 — 2026-11-16

- Add an in-plugin whole-ledger diagnostics report grouped by project.
- Add clipboard export for the diagnostics report and portable managed-record JSON.
- Embed concise help and link the full multilingual guide, removing the runtime dependency on a vault-side guide note.
- Complete the migration away from the legacy Python CLI and vault-hosted development checkout.

## 0.4.0 — 2026-10-30

- Add one-line project capture from command palette/dashboard, optional owner/deadline, reserved PRJ identifiers and independent folders.
- Keep captured projects planned; edit goal, outcome and budget before activation. Preserve creation reservations across failures.
- Support GC quarter/year navigation, period detection and live panels alongside NC periods.
- Fix the usage-guide command callback and show captured project titles on cards.
- Document shared daily/weekly planning, calendar scales and evidence-preserving rescheduling in all three guide languages.

# Changelog

## 0.3.0 — 2026-10-28

First standalone public release.

- Publish UCIT Home with installation documentation, synthetic tests and reproducible release packaging.
- Add New Calendar Suite note navigation, locale-aware weeks and NC phase/month/season/year support.
- Add GC/NC workload markers and live periodic-note task blocks.
- Add selected-date planning, periodic-note commands and configurable standalone folders.
- Retain quick task creation, guarded PAWSC updates, evidence and dependency checks, date agendas and capacity planning from the local 0.2 series.

Validation covers in-memory note operations, YAML, calendar contracts and mocked UI rendering. Actual Obsidian/mobile UI behavior still needs user verification.
