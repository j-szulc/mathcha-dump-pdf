# mathcha-dump-pdf

Automates Mathcha's own import, directory export, print-settings, and print-preview UI in a Chromium-based browser. It reuses `./user_data`, so multifile operations run in the Mathcha account stored in that profile.

Requires Node.js 22.12+ and an installed Chromium-based browser such as Brave, Google Chrome, Chromium, Microsoft Edge, or Vivaldi.

Install dependencies:

```sh
mise run install
```

## Log in and select a browser

```sh
mise run run -- login
```

`login` is the only interactive command. It detects commonly installed Chromium-based browsers, asks which one to use, opens it with `./user_data`, and waits for you to complete Mathcha login and press Enter. After verifying the session, it stores the selected executable path in `./user_data/browser-path`.

Skip browser selection by passing a detected name or executable path:

```sh
mise run run -- login --browser brave
mise run run -- login --browser "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

All other commands read `user_data/browser-path`, run headlessly by default, and never prompt. Pass `--kiosk` to show their browser actions in a visible window. If the file is missing, its browser no longer exists, or the Mathcha session has expired, they stop and instruct you to run `login` again.

## Export the account as one directory

```sh
mise run run -- export-as-mathcha-dir exports/account.mathcha
```

This runs headlessly unless `--kiosk` is passed, collapses the sidebar tree, creates a new root directory, moves every existing root document and directory into it through Mathcha's `Move Document` / `Move Directory` dialogs, and uses `Save as .mathcha file`. It waits for both Mathcha's success state and a completed browser download.

Use the included test archive without reorganizing the account:

```sh
mise run run -- export-as-mathcha-dir exports/test.mathcha --import-instead
```

`--import-instead` imports [`test/fixtures/testdata.mathcha`](test/fixtures/testdata.mathcha), identifies the imported root directory, and exports that directory. Use `--test-data PATH` to supply another fixture.

For large accounts, export documents in smaller Mathcha-native batches:

```sh
mise run run -- export-as-mathcha-dir exports/account.mathcha --batch-size 50
```

Batch mode recursively expands the complete export directory, selects at most 50 documents at a time, and runs Mathcha's normal export dialog, resource processing, progress reporting, and download for each selection. Mathcha preserves common directory ancestry for multi-document selections; a one-document batch is exported as a root document, matching Mathcha's normal behavior. Mathcha cannot reliably combine a document located directly in a directory with documents from that directory's nested subdirectories, so the planner separates those cases and may produce additional smaller batches. The final progress count is verified before each archive is accepted. A four-batch run produces:

```text
account.part-001-of-004.mathcha
account.part-002-of-004.mathcha
account.part-003-of-004.mathcha
account.part-004-of-004.mathcha
```

Batch archives are intentionally independent outputs; they are not merged locally. If the document count fits in one batch, the requested output filename is used unchanged.

## Print every document in an archive

```sh
mise run run -- print-mathcha test/fixtures/testdata.mathcha --output-dir pdfs
```

`print-mathcha` runs headlessly unless `--kiosk` is passed. It imports the archive through `Menu > Import from .mathcha file`, expands its directory tree recursively, and for each document:

1. opens the document;
2. presses `Command+P`;
3. sets `Page Size > Page` to `Same as Document`;
4. opens `Print Preview`;
5. uses Mathcha's preview `Print` action to install its calculated `@page` size, then asks the browser's print engine for a PDF. No browser paper dimensions, margins, scale, headers, or other print options are overridden.

PDFs reproduce the imported directory structure below the output directory. Existing PDFs are preserved by adding a numeric suffix.

## Terminal progress logging

All commands continuously report their work with an ISO timestamp, severity, and elapsed command time. The log covers browser startup and shutdown, Mathcha readiness and login, import/export dialog progress, directory moves and expansion, archive/PDF write sizes, per-document counts and percentages, print-preview layout, and stage durations. For example:

```text
[2026-07-18T12:34:56.789Z] [STEP] [+2.1s] Mathcha import started
[2026-07-18T12:34:57.012Z] [PROGRESS] [+2.3s] Mathcha import: Entity: 3/8 | Resources: 1/4
[2026-07-18T12:35:01.456Z] [PROGRESS] [+6.7s] Documents: 2/4 (50%) — dump/Algebra/Quadratics
```

Run a command with `--debug` to include Mathcha's browser console, page errors, API response details, and lower-level UI milestones. On failure, the terminal identifies the failed browser stage and the last visible page is saved to `./debug/last-error.png` and `./debug/last-error.html`. If the browser window or tab closed first, the CLI reports that explicitly.

## Project layout

```text
bin/                CLI entrypoint
src/                Browser automation and shared runtime modules
test/               Unit tests
test/fixtures/      Bundled .mathcha archive used by --import-instead
reference/          Versioned snapshots of inspected Mathcha client assets
user_data/          Ignored browser profile, login session, and browser-path file
outputs/, pdfs/     Ignored generated artifacts
```

## Mathcha client snapshot

The exact minified client files inspected for this implementation are preserved under [`reference/mathcha-client/2026-07-18-c2e57134`](reference/mathcha-client/2026-07-18-c2e57134). They are debugging references only; the CLI automates the live UI.
