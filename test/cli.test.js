"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseArgs } = require("../bin/mathcha-dump-pdf");
const {
	browserPathFile,
	loadBrowserPath,
	resolveRequestedBrowser,
	storeBrowserPath,
} = require("../src/browser-config");
const { formatBytes, formatDuration, formatLogLine, logger, percentage } = require("../src/logger");
const { buildDocumentBatches } = require("../src/mathcha");
const { safePathSegment } = require("../src/utils");

test("export command is headless by default", () => {
	const options = parseArgs(["export-as-mathcha-dir"]);
	assert.equal(options.headless, true);
	assert.equal(options.kiosk, false);
	assert.equal(options.importInstead, false);
});

test("kiosk mode makes export and print browser actions visible", () => {
	for (const args of [
		["export-as-mathcha-dir", "--kiosk"],
		["print-mathcha", "fixture.mathcha", "--kiosk"],
	]) {
		const options = parseArgs(args);
		assert.equal(options.kiosk, true);
		assert.equal(options.headless, false);
	}
});

test("import-instead uses the bundled testdata.mathcha fixture", () => {
	const options = parseArgs(["export-as-mathcha-dir", "--import-instead"]);
	assert.equal(options.headless, true);
	assert.equal(options.importInstead, true);
	assert.equal(options.testData, path.resolve("test/fixtures/testdata.mathcha"));
});

test("export accepts a positive integer batch size", () => {
	const options = parseArgs(["export-as-mathcha-dir", "--batch-size", "25"]);
	assert.equal(options.batchSize, 25);
	assert.throws(
		() => parseArgs(["export-as-mathcha-dir", "--batch-size", "1.5"]),
		/positive integer/,
	);
});

test("batch planning avoids Mathcha's direct-parent plus nested-document export bug", () => {
	const documents = [
		{ title: "a", pathParts: ["dump", "baz", "a"] },
		{ title: "b", pathParts: ["dump", "foo", "bar", "b"] },
		{ title: "c", pathParts: ["dump", "foo", "c"] },
		{ title: "d", pathParts: ["dump", "d"] },
	];
	assert.deepEqual(
		buildDocumentBatches(documents, 2).map((batch) => batch.map((document) => document.title)),
		[["a", "b"], ["c"], ["d"]],
	);
	assert.deepEqual(
		buildDocumentBatches(documents, 3).map((batch) => batch.map((document) => document.title)),
		[["a", "b", "c"], ["d"]],
	);
});

test("login is the only headful command and accepts a browser override", () => {
	const options = parseArgs(["login", "--browser", process.execPath]);
	assert.equal(options.headless, false);
	assert.equal(options.browser, process.execPath);
});

test("the unsupported headful alias remains unknown", () => {
	assert.throws(
		() => parseArgs(["export-as-mathcha-dir", "--headful"]),
		/Unknown option: --headful/,
	);
});

test("print command requires one archive and is headless by default", () => {
	const options = parseArgs(["print-mathcha", "fixture.mathcha"]);
	assert.equal(options.headless, true);
	assert.deepEqual(options.positionals, ["fixture.mathcha"]);
});

test("unsafe document title characters become safe path segments", () => {
	assert.equal(safePathSegment('A/B: C?*'), "A_B_ C__");
});

test("progress logging helpers format sizes, durations, and percentages", () => {
	assert.equal(formatBytes(1536), "1.50 KiB");
	assert.equal(formatDuration(1500), "1.5 s");
	assert.equal(percentage(2, 4), "50%");
});

test("log lines color severity and timing metadata when colors are enabled", () => {
	const line = formatLogLine("WARN", "Careful", { color: true });
	assert.match(line, /\u001b\[/);
	assert.match(line, /\[WARN\].*Careful/);
	assert.doesNotMatch(formatLogLine("WARN", "Careful", { color: false }), /\u001b\[/);
});

test("determinate progress uses progress bars", () => {
	let output = "";
	const stream = {
		clearLine() {},
		columns: 100,
		cursorTo() {},
		isTTY: true,
		write(chunk) {
			output += chunk;
		},
	};
	const progressBar = logger.progressBar("Documents", 2, { renderThrottle: 0, stream });
	progressBar.tick("First");
	progressBar.tick("Second");
	assert.match(output, /Documents \[/);
	assert.match(output, /2\/2 \(100%\) Second/);
});

test("browser path is stored inside user_data and loaded for later commands", (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-browser-config-"));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const configPath = storeBrowserPath(directory, process.execPath);
	assert.equal(configPath, browserPathFile(directory));
	assert.equal(fs.readFileSync(configPath, "utf8"), `${process.execPath}\n`);
	assert.equal(loadBrowserPath(directory), process.execPath);
	assert.equal(resolveRequestedBrowser(process.execPath), process.execPath);
});

test("missing browser configuration instructs the user to run login", (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-browser-missing-"));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	assert.throws(() => loadBrowserPath(directory), /mathcha-dump-pdf login/);
});
