"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chooseBrowser, storeBrowserPath } = require("./browser-config");
const { withMathchaBrowser } = require("./browser");
const { formatBytes, formatDuration, logger, percentage } = require("./logger");
const {
	askToContinue,
	assertFile,
	delay,
	safePathSegment,
	uniqueFilePath,
	waitForStableFile,
} = require("./utils");

const MAIN_TREE_SELECTOR = "document-sidebar document-tree";

async function withModalProgress(page, label, operation) {
	let stopped = false;
	let lastSignature = "";
	const monitor = (async () => {
		while (!stopped && !page.isClosed()) {
			try {
				const values = await page.evaluate(() => {
					const modal = document.querySelector("modal-dialog");
					if (!modal) return [];
					const explicit = [...modal.querySelectorAll(".progressbar-text, [class*='progress-text']")]
						.map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
						.filter(Boolean);
					if (explicit.length > 0) return [...new Set(explicit)];
					return (modal.innerText || "")
						.split("\n")
						.map((line) => line.replace(/\s+/g, " ").trim())
						.filter((line) => /(?:\d+\s*\/\s*\d+|\d+%)/.test(line));
				});
				const signature = [...new Set(values)].join(" | ");
				if (signature && signature !== lastSignature) {
					logger.progress(`${label}: ${signature}`);
					lastSignature = signature;
				}
			} catch (error) {
				logger.debug(`${label} progress monitor stopped reading the page: ${error.message}`);
			}
			await delay(250);
		}
	})();
	try {
		return await operation();
	} finally {
		stopped = true;
		await monitor;
	}
}

function eventStub(overrides = {}) {
	return {
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		button: 0,
		keyCode: 0,
		...overrides,
	};
}

async function invokeReactHandler(element, handlerName, overrides = {}) {
	if (!element) {
		throw new Error(`Cannot invoke ${handlerName}: element was not found`);
	}
	await element.evaluate(
		(node, { handlerName: name, overrides: eventOverrides }) => {
			const key = Object.keys(node).find((item) => item.startsWith("__reactInternalInstance"));
			const handler = key && node[key] && node[key]._currentElement.props[name];
			if (typeof handler !== "function") {
				throw new Error(`Mathcha element has no React ${name} handler`);
			}
			const event = {
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
				button: 0,
				keyCode: 0,
				stopPropagation() {},
				preventDefault() {},
				...eventOverrides,
			};
			handler(event);
		},
		{ handlerName, overrides },
	);
}

async function mouseDown(element) {
	if (!element) {
		throw new Error("Cannot press a missing Mathcha control");
	}
	await element.evaluate((node) => {
		node.dispatchEvent(
			new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
				view: window,
			}),
		);
	});
}

async function elementByText(page, selector, text, exact = true) {
	const handle = await page.evaluateHandle(
		({ selector: query, text: expected, exact: exactMatch }) =>
			[...document.querySelectorAll(query)].find((element) => {
				const actual = (element.textContent || "").trim();
				return exactMatch ? actual === expected : actual.includes(expected);
			}),
		{ selector, text, exact },
	);
	const element = handle.asElement();
	if (!element) {
		await handle.dispose();
	}
	return element;
}

async function waitForTreeSettled(page) {
	await page.waitForFunction(
		(selector) => {
			const tree = document.querySelector(selector);
			if (!tree) return false;
			const signature = tree.innerHTML;
			const state = window.__mathchaDumpTreeState || { signature: null, stable: 0 };
			if (state.signature === signature) state.stable += 1;
			else {
				state.signature = signature;
				state.stable = 0;
			}
			window.__mathchaDumpTreeState = state;
			return state.stable >= 2;
		},
		{ polling: 250 },
		MAIN_TREE_SELECTOR,
	);
}

async function assertLoggedIn(page) {
	const loginName = await page.evaluate(() => {
		const element = document.querySelector("login-name");
		return element ? (element.textContent || "").trim() : "";
	});
	if (!loginName || /log\s*in|sign\s*in/i.test(loginName)) {
		throw new Error(
			"Mathcha login is missing or expired. Run `mathcha-dump-pdf login` and complete login in the browser.",
		);
	}
	return loginName;
}

async function listRootItems(page) {
	return page.evaluate((selector) => {
		const tree = document.querySelector(selector);
		if (!tree) return [];
		const result = [];
		for (const child of tree.children) {
			if (child.matches("node-document")) {
				result.push({ type: "document", title: child.getAttribute("title") || "Untitled" });
				continue;
			}
			const directoryName = child.querySelector(":scope > node-directory > node-directory-name");
			if (directoryName) {
				result.push({
					type: "directory",
					title: directoryName.getAttribute("title") || "Untitled",
				});
			}
		}
		return result;
	}, MAIN_TREE_SELECTOR);
}

async function rootNode(page, reference) {
	const handle = await page.evaluateHandle(
		({ selector, reference: wanted }) => {
			const tree = document.querySelector(selector);
			if (!tree) return null;
			const matches = [];
			for (const child of tree.children) {
				if (wanted.type === "document" && child.matches("node-document")) {
					if ((child.getAttribute("title") || "Untitled") === wanted.title) matches.push(child);
			}
			if (wanted.type === "directory") {
					const name = child.querySelector(":scope > node-directory > node-directory-name");
					if (name && (name.getAttribute("title") || "Untitled") === wanted.title) matches.push(name);
				}
			}
			return matches[wanted.occurrence || 0] || null;
		},
		{ selector: MAIN_TREE_SELECTOR, reference },
	);
	const element = handle.asElement();
	if (!element) {
		await handle.dispose();
		throw new Error(`Root ${reference.type} was not found: ${reference.title}`);
	}
	return element;
}

async function modalButton(page, label) {
	const button = await elementByText(page, "modal-dialog button", label);
	if (!button) throw new Error(`Mathcha dialog button was not found: ${label}`);
	return button;
}

async function clickModalButton(page, label) {
	const button = await modalButton(page, label);
	const disabled = await button.evaluate((node) => node.disabled);
	if (disabled) throw new Error(`Mathcha dialog button is disabled: ${label}`);
	await invokeReactHandler(button, "onClick", eventStub());
}

async function openMainMenu(page) {
	const button = await page.$(".menu-bar-container .button");
	if (!button) throw new Error("Mathcha Menu button was not found");
	const isOpen = await page.$eval(".menu-bar-container .items", (element) =>
		element.classList.contains("show"),
	);
	if (!isOpen) await mouseDown(button);
	await page.waitForSelector(".menu-bar-container .items.show");
}

async function collapseAll(page) {
	const more = await page.$("document-sidebar-header expandable-component");
	if (!more) throw new Error("Sidebar three-dot menu was not found");
	await mouseDown(more);
	const item = await elementByText(page, "document-sidebar-header label-item", "Collapse All");
	if (!item) throw new Error("Collapse All action was not found");
	await mouseDown(item);
	await page.waitForFunction(
		(selector) =>
			![...document.querySelectorAll(`${selector} node-directory-name`)].some((node) =>
				node.classList.contains("expanded"),
			),
		{},
		MAIN_TREE_SELECTOR,
	);
}

function defaultDirectoryName() {
	const now = new Date();
	const stamp = now
		.toISOString()
		.replace("T", " ")
		.replace(/:/g, "-")
		.replace(/\.\d{3}Z$/, "");
	return `Mathcha Export ${stamp}`;
}

async function createRootDirectory(page, requestedName) {
	const before = await listRootItems(page);
	let name = requestedName || defaultDirectoryName();
	if (before.some((item) => item.type === "directory" && item.title === name)) {
		name = `${name} ${Date.now()}`;
	}
	const occurrence = before.filter(
		(item) => item.type === "directory" && item.title === name,
	).length;
	const create = await page.$('icon[title="Create New Directory"]');
	if (!create) throw new Error("Create New Directory control was not found");
	await invokeReactHandler(create, "onClick");
	const input = await page.waitForSelector("modal-dialog document-name textarea");
	await input.type(name);
	await page.waitForFunction(() => {
		const button = document.querySelector("modal-dialog button.ok");
		return button && !button.disabled;
	});
	await clickModalButton(page, "Ok");
	await page.waitForFunction(
		({ selector, name, occurrence }) => {
			const tree = document.querySelector(selector);
			if (!tree) return false;
			const names = [...tree.children]
				.map((child) => child.querySelector(":scope > node-directory > node-directory-name"))
				.filter(Boolean)
				.filter((node) => node.getAttribute("title") === name);
			return names.length > occurrence;
		},
		{},
		{ selector: MAIN_TREE_SELECTOR, name, occurrence },
	);
	return { type: "directory", title: name, occurrence };
}

async function selectNode(page, reference) {
	const node = await rootNode(page, reference);
	await invokeReactHandler(node, "onClick", eventStub());
	await page.waitForSelector("option-select-placeholder icon-dropdown");
}

async function openNodeAction(page, reference, action) {
	await selectNode(page, reference);
	const dropdown = await page.$("option-select-placeholder icon-dropdown");
	await invokeReactHandler(dropdown, "onClick", eventStub());
	await page.waitForSelector(`icon-dropdown-item[name="${action}"]`);
	await mouseDown(await page.$(`icon-dropdown-item[name="${action}"]`));
}

async function moveRootItem(page, item, target, countBefore) {
	await openNodeAction(page, { ...item, occurrence: 0 }, "move");
	await page.waitForFunction(() => {
		const modal = document.querySelector("modal-dialog");
		return modal && (modal.textContent || "").includes("Moving");
	});
	const targetNodeHandle = await page.evaluateHandle((name) =>
		[...document.querySelectorAll("modal-dialog node-directory-name")].find(
			(node) => node.getAttribute("title") === name && !node.classList.contains("disabled"),
		), target.title);
	const targetNode = targetNodeHandle.asElement();
	if (!targetNode) {
		await targetNodeHandle.dispose();
		throw new Error(`Move destination was not available: ${target.title}`);
	}
	await invokeReactHandler(targetNode, "onClick", eventStub());
	await page.waitForFunction(() => {
		const ok = document.querySelector("modal-dialog button.ok");
		return ok && !ok.disabled;
	});
	await clickModalButton(page, "Ok");
	await page.waitForFunction(() => !document.querySelector("modal-dialog"));
	await page.waitForFunction(
		({ selector, targetTitle, expectedMaximum }) => {
			const tree = document.querySelector(selector);
			if (!tree) return false;
			let count = 0;
			for (const child of tree.children) {
				if (child.matches("node-document")) count += 1;
				else {
					const name = child.querySelector(":scope > node-directory > node-directory-name");
					if (name && name.getAttribute("title") !== targetTitle) count += 1;
				}
			}
			return count <= expectedMaximum;
		},
		{},
		{
			selector: MAIN_TREE_SELECTOR,
			targetTitle: target.title,
			expectedMaximum: countBefore - 1,
		},
	);
}

async function gatherIntoDirectory(page, target) {
	let remaining = (await listRootItems(page)).filter(
		(item) => !(item.type === "directory" && item.title === target.title),
	);
	const total = remaining.length;
	logger.info(`Found ${total} root item${total === 1 ? "" : "s"} to move into ${target.title}`);
	while (remaining.length > 0) {
		const item = remaining[0];
		const itemStartedAt = Date.now();
		logger.step(`Moving root ${item.type}: ${item.title}`);
		await moveRootItem(page, item, target, remaining.length);
		remaining = (await listRootItems(page)).filter(
			(entry) => !(entry.type === "directory" && entry.title === target.title),
		);
		const completed = total - remaining.length;
		logger.progress(
			`Root moves: ${completed}/${total} (${percentage(completed, total)}) — ${item.title} completed in ${formatDuration(Date.now() - itemStartedAt)}`,
		);
	}
}

async function configureDownloads(page, directory) {
	fs.mkdirSync(directory, { recursive: true });
	logger.debug(`Configuring browser downloads for ${directory}`);
	const client = await page.createCDPSession();
	await client.send("Page.setDownloadBehavior", {
		behavior: "allow",
		downloadPath: directory,
	});
}

function moveDownloadedFile(source, destination) {
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	try {
		fs.renameSync(source, destination);
	} catch (error) {
		if (error.code !== "EXDEV") throw error;
		fs.copyFileSync(source, destination);
		fs.unlinkSync(source);
	}
}

async function saveRootAsArchive(page, reference, requestedOutput, timeout) {
	const startedAt = Date.now();
	const downloadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mathcha-export-"));
	await configureDownloads(page, downloadDirectory);
	const before = new Set(fs.readdirSync(downloadDirectory));
	logger.step(`Opening Save as .mathcha file for root directory: ${reference.title}`);
	await openNodeAction(page, reference, "save-as-zip");
	await page.waitForFunction(() => {
		const title = document.querySelector("modal-dialog header-title");
		return title && (title.textContent || "").startsWith("Export ");
	});
	logger.info("Mathcha export progress dialog opened");
	const state = await withModalProgress(page, "Mathcha export", () =>
		page.waitForFunction(() => {
			const modal = document.querySelector("modal-dialog");
			const text = modal ? modal.textContent || "" : "";
			if (text.includes("Export successfully!")) return "success";
			if (text.includes("Export failed")) return "failed";
			return false;
		}),
	);
	if ((await state.jsonValue()) !== "success") {
		throw new Error("Mathcha reported that the .mathcha export failed");
	}
	logger.info("Mathcha reported that archive generation succeeded");
	const downloaded = await waitForStableFile(downloadDirectory, before, timeout);
	const output = uniqueFilePath(requestedOutput);
	logger.step(`Moving downloaded archive to ${output}`);
	moveDownloadedFile(downloaded, output);
	fs.rmSync(downloadDirectory, { recursive: true, force: true });
	logger.info(
		`Archive stored (${formatBytes(fs.statSync(output).size)}) in ${formatDuration(Date.now() - startedAt)}`,
	);
	return output;
}

async function importArchive(page, archivePath) {
	assertFile(archivePath, ".mathcha");
	const startedAt = Date.now();
	logger.step(`Preparing to import ${archivePath} (${formatBytes(fs.statSync(archivePath).size)})`);
	await waitForTreeSettled(page);
	const before = await listRootItems(page);
	logger.debug(`Document tree contained ${before.length} root items before import`);
	logger.step("Opening Menu > Import .mathcha file");
	await openMainMenu(page);
	const importItem = await page.$('.menu-bar-container [data-name="import-from-zip"]');
	if (!importItem) throw new Error("Menu > Import from .mathcha file was not found");
	await mouseDown(importItem);
	await page.waitForFunction(() => {
		const title = document.querySelector("modal-dialog header-title");
		return title && (title.textContent || "").trim() === "Import .mathcha file";
	});
	const fileInput = await page.$('modal-dialog input[type="file"]');
	logger.info("Import dialog opened; attaching archive");
	await fileInput.uploadFile(archivePath);
	await page.waitForFunction(() => {
		const buttons = [...document.querySelectorAll("modal-dialog button")];
		const button = buttons.find((item) => (item.textContent || "").trim() === "Import");
		return button && !button.disabled;
	});
	await clickModalButton(page, "Import");
	logger.step("Mathcha import started");
	const result = await withModalProgress(page, "Mathcha import", () =>
		page.waitForFunction(() => {
			const modal = document.querySelector("modal-dialog");
			const text = modal ? modal.textContent || "" : "";
			if (text.includes("Importing successfully!")) return { state: "success", text };
			if (text.includes("Importing failed")) return { state: "failed", text };
			return false;
		}),
	);
	const value = await result.jsonValue();
	if (value.state !== "success") {
		throw new Error(`Mathcha import failed: ${value.text.trim()}`);
	}
	const match = value.text.match(/New Folder\s+"([^"]+)"\s+added/);
	if (!match) throw new Error("Could not read the imported directory name from Mathcha");
	const title = match[1];
	const occurrence = before.filter(
		(item) => item.type === "directory" && item.title === title,
	).length;
	await clickModalButton(page, "Close");
	await page.waitForFunction(() => !document.querySelector("modal-dialog"));
	await page.waitForFunction(
		({ selector, title, occurrence }) => {
			const tree = document.querySelector(selector);
			if (!tree) return false;
			const matches = [...tree.children]
				.map((child) => child.querySelector(":scope > node-directory > node-directory-name"))
				.filter((node) => node && node.getAttribute("title") === title);
			return matches.length > occurrence;
		},
		{},
		{ selector: MAIN_TREE_SELECTOR, title, occurrence },
	);
	logger.info(
		`Imported root directory: ${title} (${formatDuration(Date.now() - startedAt)})`,
	);
	return { type: "directory", title, occurrence };
}

async function rootDirectoryContainer(page, reference) {
	const name = await rootNode(page, reference);
	const container = await name.evaluateHandle((node) => node.parentElement);
	await name.dispose();
	return container.asElement();
}

async function expandAllDirectories(page, rootReference) {
	let expanded = 0;
	logger.step(`Recursively expanding directory tree below ${rootReference.title}`);
	for (;;) {
		const root = await rootDirectoryContainer(page, rootReference);
		const collapsedHandle = await root.evaluateHandle((container) => {
			const names = [...container.querySelectorAll("node-directory-name")];
			return (
				names.find((node) => {
					if (node.classList.contains("expanded")) return false;
					const icon = node.querySelector(":scope > icon");
					const rect = node.getBoundingClientRect();
					return (
						icon &&
						getComputedStyle(icon).visibility !== "hidden" &&
						rect.width > 0 &&
						rect.height > 0
					);
				}) || null
			);
		});
		await root.dispose();
		const collapsed = collapsedHandle.asElement();
		if (!collapsed) {
			await collapsedHandle.dispose();
			break;
		}
		const directoryTitle = await collapsed.evaluate(
			(node) => node.getAttribute("title") || "Untitled",
		);
		await invokeReactHandler(collapsed, "onDoubleClick", eventStub());
		await page.waitForFunction((node) => node.classList.contains("expanded"), {}, collapsed);
		await collapsed.dispose();
		expanded += 1;
		logger.progress(`Directory expansion: ${expanded} expanded — ${directoryTitle}`);
	}
	logger.info(`Directory expansion complete: ${expanded} director${expanded === 1 ? "y" : "ies"}`);
}

async function listDocuments(page, rootReference) {
	const root = await rootDirectoryContainer(page, rootReference);
	const documents = await root.evaluate((container) => {
		const result = [];
		for (const documentNode of container.querySelectorAll("node-document")) {
			const rect = documentNode.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) continue;
			const parents = [];
			let current = documentNode.parentElement;
			while (current && current !== container.parentElement) {
				if (current.tagName === "NODE-DIRECTORY") {
					const name = current.querySelector(":scope > node-directory-name");
					if (name) parents.push(name.getAttribute("title") || "Untitled");
				}
				if (current === container) break;
				current = current.parentElement;
			}
			parents.reverse();
			result.push({
				title: documentNode.getAttribute("title") || "Untitled",
				pathParts: [...parents, documentNode.getAttribute("title") || "Untitled"],
			});
		}
		return result;
	});
	await root.dispose();
	return documents;
}

async function documentByIndex(page, rootReference, index) {
	const root = await rootDirectoryContainer(page, rootReference);
	const handle = await root.evaluateHandle((container, wantedIndex) => {
		const visible = [...container.querySelectorAll("node-document")].filter((node) => {
			const rect = node.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		});
		return visible[wantedIndex] || null;
	}, index);
	await root.dispose();
	const element = handle.asElement();
	if (!element) {
		await handle.dispose();
		throw new Error(`Document ${index + 1} disappeared from the expanded tree`);
	}
	return element;
}

async function chooseSameAsDocument(page) {
	const current = await page.evaluate(() => {
		const label = [...document.querySelectorAll("modal-dialog span")].find(
			(node) => (node.textContent || "").trim() === "Page:",
		);
		const value = label && label.parentElement.querySelector("input-like");
		return value ? (value.textContent || "").trim() : "";
	});
	if (current === "Same as Document") {
		logger.info("Print page size is already Same as Document");
		return;
	}
	logger.step(`Changing print page size from ${current || "unknown"} to Same as Document`);
	await page.evaluate(() => {
		const label = [...document.querySelectorAll("modal-dialog span")].find(
			(node) => (node.textContent || "").trim() === "Page:",
		);
		const input = label && label.parentElement.querySelector(".input-container");
		if (!input) throw new Error("Print Settings > Page Size > Page was not found");
		input.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }),
		);
	});
	await page.waitForSelector('modal-dialog [data-key="same-as-doc"]');
	const option = await page.$('modal-dialog [data-key="same-as-doc"]');
	await mouseDown(await option.evaluateHandle((node) => node.parentElement));
	await page.waitForFunction(() => {
		const label = [...document.querySelectorAll("modal-dialog span")].find(
			(node) => (node.textContent || "").trim() === "Page:",
		);
		const value = label && label.parentElement.querySelector("input-like");
		return value && (value.textContent || "").trim() === "Same as Document";
	});
	logger.info("Print page size selected: Same as Document");
}

async function waitForPrintContent(page) {
	await page.waitForSelector("#print-container");
	await page.evaluate(() => document.fonts.ready);
	try {
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll("#print-container img")].every(
					(image) => image.complete,
				),
			{ timeout: 10_000 },
		);
	} catch (error) {
		logger.warn("Some document images were still loading after 10 seconds; printing current content");
	}
	// Mathcha lays out print pages asynchronously after inserting the container.
	await page.waitForFunction(() => {
		const pages = [...document.querySelectorAll("#print-container .print-page-level")];
		return pages.length > 0 && pages.every((item) => item.getBoundingClientRect().height > 0);
	});
	const layout = await page.evaluate(() => {
		const pages = [...document.querySelectorAll("#print-container .print-page-level")];
		const first = pages[0]?.getBoundingClientRect();
		return {
			pages: pages.length,
			width: first ? Math.round(first.width) : 0,
			height: first ? Math.round(first.height) : 0,
			images: document.querySelectorAll("#print-container img").length,
		};
	});
	logger.info(
		`Print preview content ready: ${layout.pages} page${layout.pages === 1 ? "" : "s"}, first page ${layout.width}x${layout.height}px, ${layout.images} image${layout.images === 1 ? "" : "s"}`,
	);
}

async function applyMathchaBrowserPrintStyle(page) {
	logger.step("Applying Mathcha's calculated browser print style");
	await page.evaluate(() => {
		window.__mathchaDumpOriginalPrint = window.print;
		window.print = () => undefined;
	});
	try {
		const print = await elementByText(
			page,
			".print-preview-controls-container button",
			"Print",
		);
		if (!print) throw new Error("Mathcha Print Preview Print button was not found");
		await invokeReactHandler(print, "onClick", eventStub());
		await page.waitForFunction(() => {
			const style = document.querySelector("#print-style");
			return style && (style.textContent || "").includes("@page");
		});
		const pageRule = await page.$eval("#print-style", (style) =>
			(style.textContent || "").replace(/\s+/g, " ").trim(),
		);
		logger.info(`Mathcha print CSS installed: ${pageRule}`);
	} finally {
		await page.evaluate(() => {
			if (window.__mathchaDumpOriginalPrint) {
				window.print = window.__mathchaDumpOriginalPrint;
				delete window.__mathchaDumpOriginalPrint;
			}
		});
	}
}

async function closePrintUi(page) {
	logger.debug("Closing Mathcha print preview");
	const closeHandle = await page.evaluateHandle(() =>
		[...document.querySelectorAll("button")].find((button) => {
			const rect = button.getBoundingClientRect();
			return (button.textContent || "").trim() === "Close" && rect.width > 0 && rect.height > 0;
		}),
	);
	const close = closeHandle.asElement();
	if (!close) {
		await closeHandle.dispose();
		throw new Error("Mathcha Print Preview Close button was not found");
	}
	await close.click();
	await close.dispose();
	await page.waitForFunction(() => !document.querySelector("#print-container"));
	const settingsStillOpen = await page.evaluate(() =>
		[...document.querySelectorAll("modal-dialog header-title")].some(
			(node) => (node.textContent || "").trim() === "Print Settings",
		),
	);
	if (settingsStillOpen) {
		await page.keyboard.press("Escape");
		await page.waitForFunction(() =>
			![...document.querySelectorAll("modal-dialog header-title")].some(
				(node) => (node.textContent || "").trim() === "Print Settings",
			),
		);
	}
	logger.debug("Mathcha print UI closed");
}

async function waitForPdfOnDisk(outputPath, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	let lastSize = -1;
	let stablePolls = 0;
	let lastReportAt = 0;
	while (Date.now() < deadline) {
		if (fs.existsSync(outputPath)) {
			const size = fs.statSync(outputPath).size;
			if (size > 0 && size === lastSize) stablePolls += 1;
			else stablePolls = 0;
			lastSize = size;
			if (Date.now() - lastReportAt >= 1000) {
				logger.progress(`PDF write: ${path.basename(outputPath)} (${formatBytes(size)})`);
				lastReportAt = Date.now();
			}
			if (stablePolls >= 2) return;
		}
		await delay(250);
	}
	throw new Error(`The browser did not finish writing a PDF: ${outputPath}`);
}

async function printCurrentDocument(page, outputPath) {
	const startedAt = Date.now();
	logger.step("Opening Mathcha Print Settings with Command+P");
	await page.keyboard.down("Meta");
	await page.keyboard.press("p");
	await page.keyboard.up("Meta");
	await page.waitForFunction(() =>
		[...document.querySelectorAll("modal-dialog header-title")].some(
			(node) => (node.textContent || "").trim() === "Print Settings",
		),
	);
	logger.info("Mathcha Print Settings opened");
	await chooseSameAsDocument(page);
	logger.step("Building Mathcha Print Preview");
	await page.waitForFunction(() => {
		const button = [...document.querySelectorAll("modal-dialog button")].find(
			(node) => (node.textContent || "").trim() === "Print Preview",
		);
		return button && !button.disabled;
	});
	const preview = await elementByText(page, "modal-dialog button", "Print Preview");
	if (!preview) throw new Error("Print Preview button was not found");
	// A real click is important here: it lets Mathcha finish its own print-process ref setup.
	await preview.click();
	await waitForPrintContent(page);
	await applyMathchaBrowserPrintStyle(page);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	// Honor Mathcha's `Same as Document` CSS page size. Paper dimensions, margins,
	// scale, headers, backgrounds, and every other browser print option stay at default.
	logger.step(`Printing with the browser to ${outputPath}`);
	let printError;
	const printPromise = page.pdf({ path: outputPath, preferCSSPageSize: true }).catch((error) => {
		printError = error;
	});
	await waitForPdfOnDisk(outputPath);
	await closePrintUi(page);
	await printPromise;
	if (printError) throw printError;
	if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
		throw new Error(`The browser did not produce a PDF: ${outputPath}`);
	}
	logger.info(
		`PDF completed (${formatBytes(fs.statSync(outputPath).size)}) in ${formatDuration(Date.now() - startedAt)}`,
	);
}

async function exportAsMathchaDir(options) {
	return withMathchaBrowser(options, async (page) => {
		logger.step("Waiting for the Mathcha document tree to settle");
		await waitForTreeSettled(page);
		const loginName = await assertLoggedIn(page);
		logger.info(`Logged in to Mathcha as ${loginName}`);

		let rootReference;
		if (options.importInstead) {
			rootReference = await importArchive(page, options.testData);
		} else {
			logger.step("Opening the sidebar three-dot menu and selecting Collapse All");
			await collapseAll(page);
			logger.info("Document tree collapsed");
			logger.step("Creating a new root directory");
			rootReference = await createRootDirectory(page, options.name);
			logger.info(`Created root directory: ${rootReference.title}`);
			await gatherIntoDirectory(page, rootReference);
		}

		const output = await saveRootAsArchive(
			page,
			rootReference,
			options.outputPath,
			options.timeout,
		);
		logger.info(`Saved .mathcha archive: ${output}`);
		return output;
	});
}

async function loginMathcha(options) {
	const browserPath = await chooseBrowser(options.browser);
	logger.info(`Selected browser: ${browserPath}`);
	return withMathchaBrowser(
		{ ...options, browserPath, headless: false, loginMode: true },
		async (page, browser) => {
			logger.info("Complete Mathcha login in the browser window");
			const promptAbort = new AbortController();
			const abortPrompt = () => promptAbort.abort();
			browser.once("disconnected", abortPrompt);
			page.once("close", abortPrompt);
			try {
				await askToContinue(
					"When Mathcha is logged in, press Enter here to verify and save: ",
					{ signal: promptAbort.signal },
				);
			} catch (error) {
				if (promptAbort.signal.aborted) {
					throw new Error("The browser window or tab was closed before login could be verified");
				}
				throw error;
			} finally {
				browser.off("disconnected", abortPrompt);
				page.off("close", abortPrompt);
			}
			if (page.isClosed()) {
				throw new Error("The browser window was closed before login could be verified");
			}
			await page.waitForSelector("document-sidebar document-tree");
			await page.waitForSelector("login-name");
			await waitForTreeSettled(page);
			const loginName = await assertLoggedIn(page);
			const configPath = storeBrowserPath(options.userDataDir, browserPath);
			logger.info(`Verified Mathcha login as ${loginName}`);
			logger.info(`Saved browser path to ${configPath}`);
			return { browserPath, configPath, loginName };
		},
	);
}

async function printMathcha(options) {
	assertFile(options.inputPath, ".mathcha");
	return withMathchaBrowser(options, async (page) => {
		const loginName = await assertLoggedIn(page);
		logger.info(`Logged in to Mathcha as ${loginName}`);
		const rootReference = await importArchive(page, options.inputPath);
		await expandAllDirectories(page, rootReference);
		const documents = await listDocuments(page, rootReference);
		if (documents.length === 0) {
			throw new Error(`The imported directory contains no documents: ${rootReference.title}`);
		}
		logger.info(`Found ${documents.length} document${documents.length === 1 ? "" : "s"} to print`);
		const outputs = [];
		for (let index = 0; index < documents.length; index += 1) {
			const documentInfo = documents[index];
			const documentLabel = documentInfo.pathParts.join("/");
			logger.progress(
				`Documents: ${index + 1}/${documents.length} (${percentage(index + 1, documents.length)}) — ${documentLabel}`,
			);
			const documentNode = await documentByIndex(page, rootReference, index);
			const loadStartedAt = Date.now();
			logger.step(`Opening document: ${documentLabel}`);
			const loadedResponse = page.waitForResponse((response) => {
				const url = new URL(response.url());
				return (
					response.status() === 200 &&
					/^\/api\/documents\/[^/]+$/.test(url.pathname)
				);
			});
			await invokeReactHandler(documentNode, "onDoubleClick", eventStub());
			const response = await loadedResponse;
			const loadedId = new URL(response.url()).pathname.split("/").pop();
			logger.debug(`Document API response: ${response.status()} ${response.url()}`);
			await page.waitForFunction(
				(node, title, id) =>
					document.title === title &&
					node.id === `tn-${id}` &&
					document.querySelector("math-type .root-editor"),
				{},
				documentNode,
				documentInfo.title,
				loadedId,
			);
			await page.waitForFunction(() => {
				const save = document.querySelector("save-button");
				return !save || save.classList.contains("saved");
			});
			await delay(300);
			await documentNode.dispose();
			logger.info(
				`Document loaded and saved state confirmed (id=${loadedId}) in ${formatDuration(Date.now() - loadStartedAt)}`,
			);
			const relative = documentInfo.pathParts.map(safePathSegment);
			const candidate = path.join(options.outputDir, ...relative) + ".pdf";
			const output = uniqueFilePath(candidate);
			await printCurrentDocument(page, output);
			outputs.push(output);
			logger.info(`Saved PDF: ${output}`);
		}
		logger.info(`Printed ${outputs.length}/${documents.length} documents successfully`);
		return outputs;
	});
}

module.exports = {
	exportAsMathchaDir,
	loginMathcha,
	printMathcha,
};
