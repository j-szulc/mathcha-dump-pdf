"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const { loadBrowserPath } = require("./browser-config");
const { loadMathchaCookies } = require("./browser-session");
const { debugDir, editorUrl, viewport } = require("./config");
const { formatDuration, logger } = require("./logger");

function browserClosedError(error, page, browser) {
	const message = String(error && error.message);
	const closed = !browser.connected || !page || page.isClosed();
	if (closed || /Target closed|Session closed|Connection closed/i.test(message)) {
		return new Error(`The browser window closed before Mathcha finished. Original error: ${message}`);
	}
	return error;
}

async function captureFailure(page) {
	if (!page || page.isClosed()) {
		return;
	}
	try {
		fs.mkdirSync(debugDir, { recursive: true });
		await page.screenshot({ path: path.join(debugDir, "last-error.png"), fullPage: false });
		fs.writeFileSync(
			path.join(debugDir, "last-error.html"),
			await page.content(),
			"utf8",
		);
		logger.error(`Saved failure diagnostics in ${debugDir}`);
	} catch (captureError) {
		logger.error(`Could not capture failure diagnostics: ${captureError.message}`);
	}
}

function cloneBrowserProfile(userDataDir) {
	const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-browser-profile-"));
	try {
		fs.cpSync(userDataDir, cloneDir, {
			recursive: true,
			filter(source) {
				const name = path.basename(source);
				return !name.startsWith("Singleton") && name !== "DevToolsActivePort";
			},
		});
		return cloneDir;
	} catch (error) {
		fs.rmSync(cloneDir, { recursive: true, force: true });
		throw error;
	}
}

async function createOnlyBrowserPage(browser) {
	const leftoverPages = await browser.pages();
	const page = await browser.newPage();
	await Promise.all(leftoverPages.map((leftover) => leftover.close()));
	logger.debug(
		`Closed ${leftoverPages.length} restored browser tab${leftoverPages.length === 1 ? "" : "s"}`,
	);
	return page;
}

async function withMathchaBrowser(options, work) {
	const executablePath = options.browserPath || loadBrowserPath(options.userDataDir);
	fs.mkdirSync(options.userDataDir, { recursive: true });
	const automationProfileDir = cloneBrowserProfile(options.userDataDir);
	logger.debug(`Using isolated browser profile clone ${automationProfileDir}`);

	const launchStartedAt = Date.now();
	logger.step(`Launching browser from ${executablePath}`);
	let browser;
	try {
		browser = await puppeteer.launch({
			headless: options.headless,
			executablePath,
			userDataDir: automationProfileDir,
			args: ["--no-first-run", "--disable-features=Translate", "--kiosk-printing"],
		});
	} catch (error) {
		fs.rmSync(automationProfileDir, { recursive: true, force: true });
		throw error;
	}
	logger.info(
		`Browser launched (pid=${browser.process()?.pid || "unknown"}) in ${formatDuration(Date.now() - launchStartedAt)}`,
	);
	let page;
	try {
		page = await createOnlyBrowserPage(browser);
		logger.debug("Created the sole automation browser tab");
		page.setDefaultTimeout(options.timeout);
		page.setDefaultNavigationTimeout(options.timeout);
		await page.setViewport(viewport);
		await page.setCookie(...loadMathchaCookies(options.userDataDir));
		logger.debug("Injected saved Mathcha cookies into the isolated browser profile");
		if (options.debug) {
			page.on("console", (message) =>
				logger.debug(`[browser:${message.type()}] ${message.text()}`),
			);
			page.on("pageerror", (error) => logger.debug(`[browser:error] ${error.message}`));
		}
		const navigationStartedAt = Date.now();
		logger.step(`Opening Mathcha editor: ${editorUrl}`);
		await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
		logger.info(`Mathcha DOM loaded in ${formatDuration(Date.now() - navigationStartedAt)}`);
		logger.step("Waiting for the document sidebar and authenticated application shell");
		await page.waitForSelector("document-sidebar document-tree");
		logger.debug("Document tree element is present");
		await page.waitForFunction(() => !document.querySelector("#main-container"));
		// The outer shell appears before the authenticated tree/editor data is mounted.
		await page.waitForSelector("document-sidebar-header");
		await page.waitForSelector("login-name");
		logger.info("Mathcha application shell is ready");
		return await work(page, browser);
	} catch (error) {
		logger.error(`Browser workflow failed: ${error.message}`);
		await captureFailure(page);
		throw browserClosedError(error, page, browser);
	} finally {
		if (browser.connected) {
			logger.step("Closing browser");
			await browser.close().catch(() => undefined);
			logger.info("Browser closed");
		} else {
			logger.warn("Browser was already closed when cleanup began");
		}
		fs.rmSync(automationProfileDir, { recursive: true, force: true });
		logger.debug("Removed isolated browser profile clone");
	}
}

module.exports = { cloneBrowserProfile, createOnlyBrowserPage, withMathchaBrowser };
