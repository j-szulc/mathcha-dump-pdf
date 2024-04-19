const fs = require("fs");

function sleep(ms) {
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

module.exports = {
	sleep,
	print,
};
