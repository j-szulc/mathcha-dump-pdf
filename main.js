const puppeteer = require("puppeteer"); // v20.7.4 or later
const mathcha = require("./mathcha");
const { sleep } = require("./utils");
const timeout = 5000;

const reader = require("readline-sync");

(async () => {
	const browser = await puppeteer.launch({
		headless: false,
		executablePath:
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		args: ["--kiosk-printing"],
		// devtools: true,
		userDataDir: "./user_data",
	});
	const page = await browser.newPage();

	page.setDefaultTimeout(timeout);

	{
		const targetPage = page;
		await targetPage.setViewport({
			width: 869,
			height: 817,
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

	reader.question("Press any key to continue or Ctrl+C to exit: ");
	docs = await mathcha.get_documents(page);

	for (element of docs) {
		await element.click();
		await sleep(1000);
		await mathcha.process_current_document(page);
		reader.question("Press any key to continue or Ctrl+C to exit: ");
	}

	await browser.close();
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
