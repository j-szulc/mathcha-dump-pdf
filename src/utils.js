"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { formatBytes, logger } = require("./logger");

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function askQuestion(message, options = {}) {
	const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await terminal.question(message, options);
	} finally {
		terminal.close();
	}
}

async function askToContinue(message, options = {}) {
	await askQuestion(message, options);
}

function assertFile(filePath, extension) {
	if (path.extname(filePath).toLowerCase() !== extension) {
		throw new Error(`Expected a ${extension} file: ${filePath}`);
	}
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		throw new Error(`File does not exist: ${filePath}`);
	}
}

function safePathSegment(value) {
	const cleaned = String(value)
		.normalize("NFKC")
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
		.replace(/[. ]+$/g, "")
		.trim();
	return cleaned || "untitled";
}

function uniqueFilePath(candidate) {
	if (!fs.existsSync(candidate)) {
		return candidate;
	}
	const directory = path.dirname(candidate);
	const extension = path.extname(candidate);
	const base = path.basename(candidate, extension);
	for (let suffix = 2; suffix < 10_000; suffix += 1) {
		const next = path.join(directory, `${base} (${suffix})${extension}`);
		if (!fs.existsSync(next)) {
			return next;
		}
	}
	throw new Error(`Could not find an unused filename for ${candidate}`);
}

async function waitForStableFile(directory, before, timeout) {
	const deadline = Date.now() + timeout;
	let lastCandidate;
	let lastSize = -1;
	let stablePolls = 0;
	let lastReportedName;
	let lastReportedSize = -1;
	let lastReportAt = 0;
	logger.step(`Watching for a completed .mathcha download in ${directory}`);
	while (Date.now() < deadline) {
		const names = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
		const partial = names.find((name) => name.endsWith(".crdownload"));
		if (partial) {
			const partialPath = path.join(directory, partial);
			const size = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
			if (
				partial !== lastReportedName ||
				(size !== lastReportedSize && Date.now() - lastReportAt >= 1000)
			) {
				logger.progress(`Archive download: ${partial} (${formatBytes(size)})`);
				lastReportedName = partial;
				lastReportedSize = size;
				lastReportAt = Date.now();
			}
		}
		const candidates = names
			.filter((name) => name.toLowerCase().endsWith(".mathcha") && !before.has(name))
			.map((name) => ({ name, stat: fs.statSync(path.join(directory, name)) }))
			.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
		if (!partial && candidates.length > 0) {
			const candidate = candidates[0];
			if (candidate.name === lastCandidate && candidate.stat.size === lastSize) {
				stablePolls += 1;
			} else {
				lastCandidate = candidate.name;
				lastSize = candidate.stat.size;
				stablePolls = 0;
			}
			if (stablePolls >= 2 && candidate.stat.size > 0) {
				logger.info(
					`Archive download completed: ${candidate.name} (${formatBytes(candidate.stat.size)})`,
				);
				return path.join(directory, candidate.name);
			}
		}
		await delay(250);
	}
	throw new Error(`No completed .mathcha download appeared in ${directory}`);
}

module.exports = {
	askQuestion,
	askToContinue,
	assertFile,
	delay,
	safePathSegment,
	uniqueFilePath,
	waitForStableFile,
};
