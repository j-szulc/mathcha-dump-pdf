const fs = require("fs");
const { defaultDelay } = require("./config");

function sleep(ms = defaultDelay) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
const print = async (targetPage, pdf_options) => {
	targetPage.emulateMediaType("print");
	// page.pdf seems to ignore the output option, so we need to write the file ourselves
	const pdf = await targetPage.pdf({ ...pdf_options, output: undefined });
	fs.writeFileSync(pdf_options.path, pdf);
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
