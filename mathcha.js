const puppeteer = require("puppeteer"); // v20.7.4 or later
const { print, sleep } = require("./utils");
const timeout = 5000;

const disappear_quick_start = async (targetPage) => {
	await puppeteer.Locator.race([
		targetPage.locator(
			"::-p-xpath(/html/body/div[1]/page/container-layer/quick-start/qs-footer/button)",
		),
	])
		.setTimeout(timeout)
		.click({
			offset: {
				x: 10,
				y: 10,
			},
		});
};

const print_meta_p = async (targetPage) => {
	await targetPage.keyboard.down("Meta");
	await targetPage.keyboard.down("p");
	await targetPage.keyboard.up("p");
	await targetPage.keyboard.up("Meta");
};

const print_preview_button = async (targetPage) => {
	await puppeteer.Locator.race([
		targetPage.locator("::-p-aria(Print Preview)"),
		targetPage.locator("modal-footer button.btn-normal"),
		targetPage.locator(
			'::-p-xpath(//*[@id=\\"root\\"]/page/div/div/modal-dialog/modal-container/modal-footer/div/buttons-group/button[1])',
		),
		targetPage.locator(":scope >>> modal-footer button.btn-normal"),
		targetPage.locator("::-p-text(Print Preview)"),
	])
		.setTimeout(timeout)
		.click({
			offset: {
				x: 66,
				y: 13.703125,
			},
		});
};

const esc = async (targetPage) => {
	await targetPage.keyboard.press("Escape");
};

const process_current_document = async (targetPage) => {
	await print_meta_p(targetPage);
	await sleep(1000);
	await print_preview_button(targetPage);
	await sleep(1000);
	targetPage.waitForSelector("#print-container");
	await sleep(1000);
	const pdf_options = {
		path: "output.pdf",
		format: "A4",
	};
	await print(targetPage, pdf_options);
	await esc(targetPage);
	await sleep(1000);
	await esc(targetPage);
};

const get_documents = async (targetPage) => {
	await targetPage.waitForSelector("node-document");
	const elements = await targetPage.$$("node-document");
	const result = [];

	for (const element of elements) {
		const isDraggable = await element.evaluate(
			(el) => el.getAttribute("draggable") !== "false",
		);
		if (!isDraggable) {
			continue;
		}
		result.push(element);
	}
	return result;
};

module.exports = {
	disappear_quick_start,
	print_meta_p,
	print_preview_button,
	process_current_document,
	get_documents,
};
