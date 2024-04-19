const fs = require("fs");
const { defaultDelay } = require("./config");
const path = require("path");

function sleep(ms = defaultDelay) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
const print = async (targetPage, targetPdfPath, pdfOptions) => {
	targetPage.emulateMediaType("print");
	const parentDir = path.dirname(targetPdfPath);
	fs.mkdirSync(parentDir, { recursive: true });
	// page.pdf seems to ignore the output option, so we need to write the file ourselves
	const pdf = await targetPage.pdf(pdfOptions);
	fs.writeFileSync(targetPdfPath, pdf);
	targetPage.emulateMediaType("screen");
};

const debug_await = (promise) => {
	promise
		.then((result) => {
			console.log(result);
		})
		.catch((error) => {
			console.error(error);
		});
	debugger;
};

module.exports = {
	sleep,
	print,
};
