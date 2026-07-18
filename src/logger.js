"use strict";

const pc = require("picocolors");

const processStartedAt = process.hrtime.bigint();
let debugEnabled = false;

function elapsedSeconds() {
	return Number(process.hrtime.bigint() - processStartedAt) / 1_000_000_000;
}

function formatLogLine(level, message, { color = pc.isColorSupported } = {}) {
	const colors = color === pc.isColorSupported ? pc : pc.createColors(color);
	const levelColors = {
		DEBUG: colors.gray,
		ERROR: colors.red,
		INFO: colors.blue,
		PROGRESS: colors.magenta,
		STEP: colors.green,
		WARN: colors.yellow,
	};
	const timestamp = `[${new Date().toISOString()}]`;
	const severity = `[${level}]`;
	const elapsed = `[+${elapsedSeconds().toFixed(1)}s]`;
	if (!color) return `${timestamp} ${severity} ${elapsed} ${message}`;
	const colorLevel = levelColors[level] || colors.white;
	return `${colors.dim(timestamp)} ${colorLevel(severity)} ${colors.cyan(elapsed)} ${message}`;
}

function write(level, message) {
	const line = formatLogLine(level, message);
	const stream = level === "ERROR" || level === "WARN" ? process.stderr : process.stdout;
	stream.write(`${line}\n`);
}

function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let value = bytes / 1024;
	let unit = units[0];
	for (let index = 1; index < units.length && value >= 1024; index += 1) {
		value /= 1024;
		unit = units[index];
	}
	return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatDuration(milliseconds) {
	if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
	if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
	const minutes = Math.floor(milliseconds / 60_000);
	const seconds = Math.round((milliseconds % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function percentage(current, total) {
	if (!total) return "0%";
	return `${Math.min(100, Math.round((current / total) * 100))}%`;
}

const logger = {
	setDebug(enabled) {
		debugEnabled = Boolean(enabled);
	},
	info(message) {
		write("INFO", message);
	},
	step(message) {
		write("STEP", message);
	},
	progress(message) {
		write("PROGRESS", message);
	},
	warn(message) {
		write("WARN", message);
	},
	error(message) {
		write("ERROR", message);
	},
	debug(message) {
		if (debugEnabled) write("DEBUG", message);
	},
};

module.exports = {
	formatBytes,
	formatDuration,
	formatLogLine,
	logger,
	percentage,
};
