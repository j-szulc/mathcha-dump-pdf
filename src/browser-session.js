"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { delay } = require("./utils");

const COOKIE_FILENAME = "mathcha-cookies.json";
const DEVTOOLS_FILENAME = "DevToolsActivePort";

function cookieFile(userDataDir) {
	return path.join(userDataDir, COOKIE_FILENAME);
}

function devtoolsFile(userDataDir) {
	return path.join(userDataDir, DEVTOOLS_FILENAME);
}

function saveMathchaCookies(userDataDir, cookies) {
	const mathchaCookies = cookies.filter((cookie) =>
		/(^|\.)mathcha\.io$/i.test(cookie.domain.replace(/^\./, "")),
	);
	if (!mathchaCookies.some((cookie) => cookie.name === "JSESSIONID")) {
		throw new Error("Mathcha session cookie was not found; complete login before continuing");
	}
	const destination = cookieFile(userDataDir);
	fs.writeFileSync(destination, `${JSON.stringify(mathchaCookies, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	fs.chmodSync(destination, 0o600);
	return { destination, count: mathchaCookies.length };
}

function loadMathchaCookies(userDataDir) {
	const source = cookieFile(userDataDir);
	if (!fs.existsSync(source)) {
		throw new Error(`Saved Mathcha cookies are missing: ${source}. Run \`mathcha-dump-pdf login\` first.`);
	}
	const cookies = JSON.parse(fs.readFileSync(source, "utf8"));
	if (!Array.isArray(cookies) || !cookies.some((cookie) => cookie.name === "JSESSIONID")) {
		throw new Error(`Saved Mathcha cookies are invalid: ${source}. Run \`mathcha-dump-pdf login\` again.`);
	}
	return cookies;
}

async function waitForDevtoolsBrowserUrl(userDataDir, timeout) {
	const source = devtoolsFile(userDataDir);
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (fs.existsSync(source)) {
			const port = Number(fs.readFileSync(source, "utf8").split(/\r?\n/, 1)[0]);
			if (Number.isInteger(port) && port > 0) return `http://127.0.0.1:${port}`;
		}
		await delay(100);
	}
	throw new Error(
		"The login browser did not expose its local debugging endpoint. Close any browser using this user_data profile and run login again.",
	);
}

module.exports = {
	cookieFile,
	devtoolsFile,
	loadMathchaCookies,
	saveMathchaCookies,
	waitForDevtoolsBrowserUrl,
};
