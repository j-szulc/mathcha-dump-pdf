#!/usr/bin/env node

"use strict";

const path = require("node:path");
const { formatDuration, logger } = require("../src/logger");
const { exportAsMathchaDir, loginMathcha, printMathcha } = require("../src/mathcha");

function usage() {
	return `Usage:
  mathcha-dump-pdf login [options]
  mathcha-dump-pdf export-as-mathcha-dir [output.mathcha] [options]
  mathcha-dump-pdf print-mathcha <input.mathcha> [options]

Commands:
  login                  Create the browser profile and open Mathcha for login.
  export-as-mathcha-dir  Put all root items in one directory and export it.
  print-mathcha          Import an archive and print every document to PDF.

Options:
  --user-data-dir PATH   Browser profile directory (default: ./user_data).
  --timeout MS           UI timeout in milliseconds.
  --debug                Print browser console messages.
  --kiosk                Show browser actions instead of running headlessly.

login options:
  --browser PATH_OR_NAME Use this Chromium browser without asking which one.

export-as-mathcha-dir options:
  --import-instead       Import the bundled test fixture and re-export its root directory.
  --test-data PATH       Archive used by --import-instead.
  --name NAME            Name for the newly-created root directory.
  --batch-size N         Export documents in numbered batches of at most N.

print-mathcha options:
  --output-dir PATH      PDF destination (default: ./pdfs).

  -h, --help             Show this help.`;
}

function takeValue(args, index, name) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function parseArgs(argv) {
	const command = argv[0];
	if (!command || command === "--help" || command === "-h") {
		return { help: true };
	}

	const options = {
		command,
		positionals: [],
		headless: command !== "login",
		userDataDir: path.resolve("user_data"),
		timeout: 120_000,
		debug: false,
		kiosk: false,
		importInstead: false,
		testData: path.resolve(__dirname, "../test/fixtures/testdata.mathcha"),
		outputDir: path.resolve("pdfs"),
	};

	for (let index = 1; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--kiosk":
				options.kiosk = true;
				options.headless = false;
				break;
			case "--debug":
				options.debug = true;
				break;
			case "--import-instead":
				options.importInstead = true;
				break;
			case "--browser":
				options.browser = takeValue(argv, index, arg);
				index += 1;
				break;
			case "--user-data-dir":
				options.userDataDir = path.resolve(takeValue(argv, index, arg));
				index += 1;
				break;
			case "--timeout":
				options.timeout = Number(takeValue(argv, index, arg));
				index += 1;
				if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
					throw new Error("--timeout must be a positive number");
				}
				break;
			case "--test-data":
				options.testData = path.resolve(takeValue(argv, index, arg));
				index += 1;
				break;
			case "--name":
				options.name = takeValue(argv, index, arg);
				index += 1;
				break;
			case "--batch-size":
				options.batchSize = Number(takeValue(argv, index, arg));
				index += 1;
				if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
					throw new Error("--batch-size must be a positive integer");
				}
				break;
			case "--output-dir":
				options.outputDir = path.resolve(takeValue(argv, index, arg));
				index += 1;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				if (arg.startsWith("--")) {
					throw new Error(`Unknown option: ${arg}`);
				}
				options.positionals.push(arg);
		}
	}

	return options;
}

async function main() {
	const startedAt = Date.now();
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(usage());
		return;
	}
	logger.setDebug(options.debug);
	logger.info(
		`Starting ${options.command} (browser=${options.headless ? "headless" : "headful"}, timeout=${options.timeout} ms)`,
	);
	logger.info(`Browser profile: ${options.userDataDir}`);

	switch (options.command) {
		case "login": {
			if (options.positionals.length !== 0) {
				throw new Error("login does not accept positional arguments");
			}
			await loginMathcha(options);
			break;
		}
		case "export-as-mathcha-dir": {
			if (options.browser) {
				throw new Error("--browser is only valid with the login command");
			}
			if (options.positionals.length > 1) {
				throw new Error("export-as-mathcha-dir accepts at most one output path");
			}
			const outputPath = path.resolve(
				options.positionals[0] || path.join("exports", "mathcha-export.mathcha"),
			);
			logger.info(`Export destination: ${outputPath}`);
			if (options.importInstead) logger.info(`Test import source: ${options.testData}`);
			await exportAsMathchaDir({ ...options, outputPath });
			break;
		}
		case "print-mathcha": {
			if (options.browser) {
				throw new Error("--browser is only valid with the login command");
			}
			if (options.positionals.length !== 1) {
				throw new Error("print-mathcha requires exactly one .mathcha file");
			}
			await printMathcha({
				...options,
				inputPath: path.resolve(options.positionals[0]),
			});
			break;
		}
		default:
			throw new Error(`Unknown command: ${options.command}\n\n${usage()}`);
	}
	logger.info(`Command completed successfully in ${formatDuration(Date.now() - startedAt)}`);
}

if (require.main === module) {
	main().catch((error) => {
		logger.error(error.message);
		if (process.env.DEBUG || process.argv.includes("--debug")) {
			logger.setDebug(true);
			logger.debug(error.stack);
		}
		process.exitCode = 1;
	});
}

module.exports = { parseArgs, usage };
