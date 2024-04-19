const puppeteer = require("puppeteer"); // v20.7.4 or later
const mathcha = require("./mathcha");
const { sleep } = require("./utils");
const { timeout, defaultDelay } = require("./config");
const reader = require("readline-sync");
const sanitize_filename = require("sanitize-filename");

(async () => {
	const browser = await puppeteer.launch({
		headless: false,
		executablePath:
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		args: ["--kiosk-printing"],
		devtools: true,
		userDataDir: "./user_data",
	});
	const page = await browser.newPage();

	page.setDefaultTimeout(timeout);

	{
		const targetPage = page;
		await targetPage.setViewport({
			width: 1440,
			height: 900,
		});
	}
	{
		const targetPage = page;
		const promises = [];
		const startWaitingForEvents = () => {
			promises.push(targetPage.waitForNavigation());
		};
		startWaitingForEvents();
		await targetPage.goto("https://www.mathcha.io/editor");
		await Promise.all(promises);
	}

	reader.question(`Please:
	1. Login to your Mathcha account
	2. Expand all documents
	3. Press any key to continue or Ctrl+C to exit.\n`);
	docs = await mathcha.get_documents(page);

	for ({ element, title, parents } of docs) {
		parents.reverse();
		const target_path = [...parents, title].map(sanitize_filename);
		const target_pdf = `./pdfs/${target_path.join("/")}.pdf`;
		console.log(`Processing: ${target_pdf}`);
		await element.click({ clickCount: 2 });
		await sleep();
		await mathcha.process_current_document(page, target_pdf);
		await sleep();
	}

	await browser.close();
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
