"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { logger } = require("./logger");
const { askQuestion } = require("./utils");

const CONFIG_FILENAME = "browser-path";

const BROWSER_CANDIDATES = {
	darwin: [
		["brave", "Brave Browser", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
		["chrome", "Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
		[
			"chrome-canary",
			"Google Chrome Canary",
			"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
		],
		["chromium", "Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
		[
			"edge",
			"Microsoft Edge",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		],
		["vivaldi", "Vivaldi", "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"],
		["opera", "Opera", "/Applications/Opera.app/Contents/MacOS/Opera"],
	],
	linux: [
		["brave", "Brave Browser", "/usr/bin/brave-browser"],
		["chrome", "Google Chrome", "/usr/bin/google-chrome"],
		["chrome", "Google Chrome Stable", "/usr/bin/google-chrome-stable"],
		["chromium", "Chromium", "/usr/bin/chromium"],
		["chromium", "Chromium Browser", "/usr/bin/chromium-browser"],
		["edge", "Microsoft Edge", "/usr/bin/microsoft-edge"],
		["vivaldi", "Vivaldi", "/usr/bin/vivaldi"],
	],
	win32: [],
};

function browserPathFile(userDataDir) {
	return path.join(userDataDir, CONFIG_FILENAME);
}

function isExecutable(filePath) {
	try {
		if (!fs.statSync(filePath).isFile()) return false;
		fs.accessSync(filePath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function windowsCandidates() {
	const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
		.filter(Boolean);
	const relative = [
		["brave", "Brave Browser", "BraveSoftware/Brave-Browser/Application/brave.exe"],
		["chrome", "Google Chrome", "Google/Chrome/Application/chrome.exe"],
		["edge", "Microsoft Edge", "Microsoft/Edge/Application/msedge.exe"],
		["vivaldi", "Vivaldi", "Vivaldi/Application/vivaldi.exe"],
	];
	return roots.flatMap((root) =>
		relative.map(([id, name, suffix]) => [id, name, path.join(root, suffix)]),
	);
}

function pathCandidates() {
	const names = [
		["brave", "Brave Browser", "brave-browser"],
		["chrome", "Google Chrome", "google-chrome"],
		["chromium", "Chromium", "chromium"],
		["edge", "Microsoft Edge", "microsoft-edge"],
		["vivaldi", "Vivaldi", "vivaldi"],
	];
	const directories = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
	return directories.flatMap((directory) =>
		names.map(([id, name, executable]) => [id, name, path.join(directory, executable)]),
	);
}

function detectInstalledBrowsers() {
	const platformCandidates =
		process.platform === "win32"
			? windowsCandidates()
			: BROWSER_CANDIDATES[process.platform] || [];
	const found = [];
	const seen = new Set();
	for (const [id, name, executablePath] of [...platformCandidates, ...pathCandidates()]) {
		if (!isExecutable(executablePath)) continue;
		let canonical = executablePath;
		try {
			canonical = fs.realpathSync(executablePath);
		} catch {
			// Keep the discovered path if the platform cannot canonicalize it.
		}
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		found.push({ id, name, executablePath });
	}
	return found;
}

function normalizeAppBundle(requestedPath) {
	const absolute = path.resolve(requestedPath);
	if (process.platform !== "darwin" || !absolute.toLowerCase().endsWith(".app")) {
		return absolute;
	}
	const executableName = path.basename(absolute, ".app");
	return path.join(absolute, "Contents", "MacOS", executableName);
}

function resolveRequestedBrowser(requested) {
	const detected = detectInstalledBrowsers();
	const normalized = requested.trim().toLowerCase();
	const named = detected.find(
		(browser) =>
			browser.id === normalized || browser.name.toLowerCase() === normalized,
	);
	const executablePath = named ? named.executablePath : normalizeAppBundle(requested);
	if (!isExecutable(executablePath)) {
		throw new Error(
			`Chromium browser is not executable: ${executablePath}. Pass an executable path or a detected name such as brave, chrome, chromium, edge, or vivaldi.`,
		);
	}
	return executablePath;
}

async function chooseBrowser(requested) {
	if (requested) return resolveRequestedBrowser(requested);
	const detected = detectInstalledBrowsers();
	if (detected.length === 0) {
		throw new Error(
			"No supported Chromium browser was detected. Run `mathcha-dump-pdf login --browser /path/to/browser`.",
		);
	}
	logger.info(
		`Detected ${detected.length} Chromium-based browser${detected.length === 1 ? "" : "s"}`,
	);
	for (let index = 0; index < detected.length; index += 1) {
		process.stdout.write(
			`  ${index + 1}. ${detected[index].name} — ${detected[index].executablePath}\n`,
		);
	}
	for (;;) {
		const answer = await askQuestion(`Choose a browser [1-${detected.length}]: `);
		const choice = Number(answer.trim());
		if (Number.isInteger(choice) && choice >= 1 && choice <= detected.length) {
			return detected[choice - 1].executablePath;
		}
		logger.warn(`Enter a number from 1 to ${detected.length}`);
	}
}

async function chooseLoginBrowser(userDataDir, requested) {
	const configPath = browserPathFile(userDataDir);
	if (fs.existsSync(configPath)) {
		const executablePath = loadBrowserPath(userDataDir);
		logger.info(`Using browser saved in ${configPath}: ${executablePath}`);
		logger.info(`To choose a different browser, delete ${userDataDir} and run login again`);
		return executablePath;
	}
	return chooseBrowser(requested);
}

function storeBrowserPath(userDataDir, executablePath) {
	const validated = resolveRequestedBrowser(executablePath);
	fs.mkdirSync(userDataDir, { recursive: true });
	const configPath = browserPathFile(userDataDir);
	fs.writeFileSync(configPath, `${validated}\n`, { encoding: "utf8", mode: 0o600 });
	fs.chmodSync(configPath, 0o600);
	return configPath;
}

function loadBrowserPath(userDataDir) {
	const configPath = browserPathFile(userDataDir);
	if (!fs.existsSync(configPath)) {
		throw new Error(
			`Browser configuration is missing: ${configPath}. Run \`mathcha-dump-pdf login\` first.`,
		);
	}
	const executablePath = fs.readFileSync(configPath, "utf8").trim();
	if (!isExecutable(executablePath)) {
		throw new Error(
			`The browser saved in ${configPath} is unavailable: ${executablePath || "empty path"}. Run \`mathcha-dump-pdf login\` again.`,
		);
	}
	return executablePath;
}

module.exports = {
	browserPathFile,
	chooseBrowser,
	chooseLoginBrowser,
	detectInstalledBrowsers,
	loadBrowserPath,
	resolveRequestedBrowser,
	storeBrowserPath,
};
