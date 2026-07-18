"use strict";

const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const { loadBrowserPath } = require("./browser-config");
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

async function withMathchaBrowser(options, work) {
	const executablePath = options.browserPath || loadBrowserPath(options.userDataDir);
	fs.mkdirSync(options.userDataDir, { recursive: true });

	const launchStartedAt = Date.now();
	logger.step(`Launching browser from ${executablePath}`);
	const browser = await puppeteer.launch({
		headless: options.headless,
		executablePath,
		userDataDir: options.userDataDir,
		args: ["--no-first-run", "--disable-features=Translate", "--kiosk-printing"],
	});
	logger.info(
		`Browser launched (pid=${browser.process()?.pid || "unknown"}) in ${formatDuration(Date.now() - launchStartedAt)}`,
	);
	let page;
	try {
		page = (await browser.pages())[0] || (await browser.newPage());
		logger.debug(`Using browser page ${page.url() || "about:blank"}`);
		page.setDefaultTimeout(options.timeout);
		page.setDefaultNavigationTimeout(options.timeout);
		await page.setViewport(viewport);
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
	}
}

module.exports = { withMathchaBrowser };
