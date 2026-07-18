"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseArgs } = require("../bin/mathcha-dump-pdf");
const { cloneBrowserProfile, createOnlyBrowserPage } = require("../src/browser");
const {
	activeBrowserPid,
	cookieFile,
	loadMathchaCookies,
	saveMathchaCookies,
} = require("../src/browser-session");
const {
	browserPathFile,
	chooseLoginBrowser,
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

test("login accepts a browser override for its directly launched profile", () => {
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
	assert.match(output, /2\/2 \(100%\) elapsed \d+(?:\.\d+)?s eta \d+(?:\.\d+)?s Second/);
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

test("login reuses browser-path when user_data already contains it", async (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-browser-reuse-"));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	storeBrowserPath(directory, process.execPath);
	assert.equal(await chooseLoginBrowser(directory, "/not/a/browser"), process.execPath);
});

test("missing browser configuration instructs the user to run login", (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-browser-missing-"));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	assert.throws(() => loadBrowserPath(directory), /mathcha-dump-pdf login/);
});

test("automation profile clones retain state without active-browser lock files", (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-browser-profile-"));
	fs.mkdirSync(path.join(directory, "Default"));
	fs.writeFileSync(path.join(directory, "Default", "Cookies"), "session state");
	fs.writeFileSync(path.join(directory, "SingletonLock"), "active browser");
	fs.writeFileSync(path.join(directory, "DevToolsActivePort"), "9222");
	const clone = cloneBrowserProfile(directory);
	context.after(() => {
		fs.rmSync(directory, { recursive: true, force: true });
		fs.rmSync(clone, { recursive: true, force: true });
	});
	assert.equal(fs.readFileSync(path.join(clone, "Default", "Cookies"), "utf8"), "session state");
	assert.equal(fs.existsSync(path.join(clone, "SingletonLock")), false);
	assert.equal(fs.existsSync(path.join(clone, "DevToolsActivePort")), false);
});

test("automation creates one fresh tab and closes all restored tabs", async () => {
	const closed = [];
	const restored = [
		{ close: async () => closed.push("first") },
		{ close: async () => closed.push("second") },
	];
	const fresh = { id: "fresh" };
	const browser = {
		pages: async () => restored,
		newPage: async () => fresh,
	};
	assert.equal(await createOnlyBrowserPage(browser), fresh);
	assert.deepEqual(closed.sort(), ["first", "second"]);
});

test("login stores only Mathcha cookies with private permissions", (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-cookie-session-"));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const session = { name: "JSESSIONID", value: "secret", domain: "www.mathcha.io", path: "/" };
	const affinity = { name: "affinity", value: "route", domain: ".mathcha.io", path: "/" };
	const unrelated = { name: "other", value: "ignore", domain: "example.com", path: "/" };
	const saved = saveMathchaCookies(directory, [session, affinity, unrelated]);
	assert.equal(saved.destination, cookieFile(directory));
	assert.deepEqual(loadMathchaCookies(directory), [session, affinity]);
	assert.equal(fs.statSync(saved.destination).mode & 0o777, 0o600);
});

test("missing extracted cookies instruct the user to login", (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-cookie-missing-"));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	assert.throws(() => loadMathchaCookies(directory), /mathcha-dump-pdf login/);
});

test("active browser profile locks resolve their owning process", (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-profile-lock-"));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	fs.symlinkSync(`test-host-${process.pid}`, path.join(directory, "SingletonLock"));
	assert.equal(activeBrowserPid(directory), process.pid);
	fs.unlinkSync(path.join(directory, "SingletonLock"));
	fs.symlinkSync("test-host-99999999", path.join(directory, "SingletonLock"));
	assert.equal(activeBrowserPid(directory), null);
});
