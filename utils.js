const fs = require("fs");
const { defaultDelay } = require("./config");
const path = require("path");
const sanitize_filename = require("sanitize-filename");

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

const gen_path = (pathParts) => {
	return `./pdfs/${pathParts.map(sanitize_filename).join("/")}.pdf`;
};

const gen_path_unique = (parents, title) => {
	const pathCandidate1 = gen_path([...parents, title]);
	if (!fs.existsSync(pathCandidate1)) {
		return pathCandidate1;
	}
	const randomString = Math.random().toString(36).substring(2, 15);
	const pathCandidate2 = gen_path([...parents, `${title}.${randomString}`]);
	if (!fs.existsSync(pathCandidate2)) {
		return pathCandidate2;
	}
	throw new Error(`Could not generate unique path for ${title}`);
};

module.exports = {
	sleep,
	print,
	gen_path_unique,
};
