# mathcha-dump-pdf

Automates Mathcha's own import, directory export, print-settings, and print-preview UI in a Chromium-based browser. It reuses `./user_data`, so multifile operations run in the Mathcha account stored in that profile.

Requires Node.js 22.12+ and an installed Chromium-based browser such as Brave, Google Chrome, Chromium, Microsoft Edge, or Vivaldi.

Install dependencies:

```sh
PUPPETEER_SKIP_DOWNLOAD=true pnpm install
```

## Log in and select a browser

```sh
pnpm start -- login
```

`login` is the only interactive command. It detects commonly installed Chromium-based browsers, asks which one to use, opens it with `./user_data`, and waits for you to complete Mathcha login and press Enter. After verifying the session, it stores the selected executable path in `./user_data/browser-path`.

Skip browser selection by passing a detected name or executable path:

```sh
pnpm start -- login --browser brave
pnpm start -- login --browser "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

All other commands read `user_data/browser-path`, run headlessly, and never prompt. If the file is missing, its browser no longer exists, or the Mathcha session has expired, they stop and instruct you to run `login` again.

## Export the account as one directory

```sh
pnpm start -- export-as-mathcha-dir exports/account.mathcha
```

This runs headlessly, collapses the sidebar tree, creates a new root directory, moves every existing root document and directory into it through Mathcha's `Move Document` / `Move Directory` dialogs, and uses `Save as .mathcha file`. It waits for both Mathcha's success state and a completed browser download.

Use the included test archive without reorganizing the account:

```sh
pnpm start -- export-as-mathcha-dir exports/test.mathcha --import-instead
```

`--import-instead` imports [`test/fixtures/testdata.mathcha`](test/fixtures/testdata.mathcha), identifies the imported root directory, and exports that directory. Use `--test-data PATH` to supply another fixture.

## Print every document in an archive

```sh
pnpm start -- print-mathcha test/fixtures/testdata.mathcha --output-dir pdfs
```

`print-mathcha` runs headlessly. It imports the archive through `Menu > Import from .mathcha file`, expands its directory tree recursively, and for each document:

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
