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
const { formatBytes, formatDuration, percentage } = require("../src/logger");
const { safePathSegment } = require("../src/utils");

test("export command is always noninteractive and headless", () => {
	const options = parseArgs(["export-as-mathcha-dir"]);
	assert.equal(options.headless, true);
	assert.equal(options.importInstead, false);
});

test("import-instead uses the bundled testdata.mathcha fixture", () => {
	const options = parseArgs(["export-as-mathcha-dir", "--import-instead"]);
	assert.equal(options.headless, true);
	assert.equal(options.importInstead, true);
	assert.equal(options.testData, path.resolve("test/fixtures/testdata.mathcha"));
});

test("login is the only headful command and accepts a browser override", () => {
	const options = parseArgs(["login", "--browser", process.execPath]);
	assert.equal(options.headless, false);
	assert.equal(options.browser, process.execPath);
});

test("normal commands cannot be switched to interactive headful mode", () => {
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
