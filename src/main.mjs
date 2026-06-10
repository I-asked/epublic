import 'core-js/modules/web.immediate';

import getopts from 'tjs:getopts';
import path from 'tjs:path';

import JSZip from 'jszip';
import { DOMParser } from 'linkedom';
import { Readability } from '@mozilla/readability';

import baseCss from './base.scss';

const mimeTypes = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};

function makeContent(doc, { doctype }) {
	const { title, content, byline, siteName, dir, lang, publishedTime } = doc;

	const xml = (new DOMParser).parseFromString(null, 'text/xml');
	xml.doctype = doctype;

	const htdoc = xml.createElement('html');
	htdoc.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
	xml.appendChild(htdoc);

	const head = xml.createElement('head');
	htdoc.appendChild(head);

	const titleEl = xml.createElement('title');
	titleEl.textContent = title ?? '';
	head.appendChild(titleEl);

	const styleEl = xml.createElement('link');
	styleEl.setAttribute('rel', 'stylesheet');
	styleEl.setAttribute('type', 'text/css');
	styleEl.setAttribute('href', 'base.css');
	head.appendChild(styleEl);

	const body = xml.createElement('body');
	body.setAttribute('dir', dir ?? 'ltr');
	htdoc.appendChild(body);

	const contentEl = xml.importNode(content, true);
	body.appendChild(contentEl);

	const toc = contentEl.querySelector('nav');

	const assets = [];
	for (const el of [...contentEl.querySelectorAll('img[src]')]) {
		assets.push(el.src);
	}

	return { xml, assets, toc };
}

function makePackage(doc, opt) {
	const xml = (new DOMParser).parseFromString(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:identifier id="pub-id" />
		<dc:title />
		<dc:creator />
		<dc:language />
		<dc:date />
		<meta property="dcterms:modified" />
	</metadata>
	<manifest>
		<item href="nav.xhtml" properties="nav" id="nav" media-type="application/xhtml+xml" />
		<item href="index.xhtml" id="content" media-type="application/xhtml+xml" />
		<item href="base.css" id="style-base" media-type="text/css" />
	</manifest>
	<spine>
		<itemref idref="nav" />
		<itemref idref="content" />
	</spine>
</package>`, 'text/xml');
	xml.querySelector('package').setAttribute('dir', doc?.dir ?? 'ltr');
	xml.querySelector('dc\\:identifier').textContent = `urn:uuid:${opt?.uuid ?? crypto.randomUUID()}`;
	xml.querySelector('dc\\:title').textContent = doc?.title ?? 'Untitled';
	xml.querySelector('dc\\:creator').textContent = doc?.byline ?? 'Unknown';
	xml.querySelector('dc\\:language').textContent = doc?.lang ?? 'en';
	const timeNow = (new Date).toISOString();
	xml.querySelector('dc\\:date').textContent = doc?.publishedTime ?? timeNow;
	xml.querySelector('meta[property="dcterms:modified"]').textContent = opt?.modifiedTime ?? timeNow;

	const mf = xml.querySelector('manifest');
	if (opt.assets) {
		let i = 0;
		for (const p of opt.assets) {
			if (path.isAbsolute(p)) { continue; }

			const el = xml.createElement('item');
			mf.appendChild(el);

			el.setAttribute('id', `asset-i${i++}`);
			el.setAttribute('href', p);
			el.setAttribute('media-type', mimeTypes[path.extname(p)] ?? 'application/octet-stream');
		}
	}

	return xml.toString();
}

function makeToc(doc, { title }) {
	const xml = (new DOMParser).parseFromString(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
	<title>Navigation</title>
	<link rel="stylesheet" type="text/css" href="base.css" />
</head>
<body>
	<nav epub:type="toc" id="toc">
		<h1>Table of Contents</h1>
		<ol>
			<li><a id="index-ref" href="index.xhtml" /></li>
		</ol>
	</nav>
</body>
</html>`, 'text/xml');
	xml.getElementById('index-ref').textContent = title ?? 'Untitled';

	const ol = xml.querySelector('ol');
	for (const el of doc.content.querySelectorAll('h1[id], h2[id], h3[id]')) {
		const li = xml.createElement('li');
		ol.appendChild(li);
		const a = xml.createElement('a');
		a.href = `index.xhtml#${el.id}`;
		a.textContent = el.textContent;
		li.appendChild(a);
	}

	return xml.toString();
}

function makeTocFromNode(el, { dir }) {
	const xml = (new DOMParser).parseFromString(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
	<title>Navigation</title>
	<link rel="stylesheet" type="text/css" href="base.css" />
</head>
<body>
</body>
</html>`, 'text/xml');
	const body = xml.querySelector('body');
	body.setAttribute('dir', dir ?? 'ltr');

	const nav = xml.importNode(el, true);
	nav.setAttribute('epub:type', 'toc');
	for (const a of [...nav.querySelectorAll('a[href]')]) {
		const href = a.getAttribute('href');
		if (href.match(/^#/)) {
			a.setAttribute('href', 'index.xhtml' + href);
		}
	}
	body.appendChild(nav);

	el.remove();

	return xml.toString();
}

async function makeEpub(html, epubFile, { base }) {
	const document = (new DOMParser).parseFromString(html, 'text/html');

	const doc = new Readability(document, { serializer: (el) => el }).parse();

	const zip = new JSZip;
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
	zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
	<rootfiles>
		<rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
	</rootfiles>
</container>`);

	const doctype = document.doctype;
	const { xml, assets, toc } = makeContent(doc, { doctype });
	zip.file('EPUB/package.opf', makePackage(doc, { assets }));
	if (toc) {
		zip.file('EPUB/nav.xhtml', makeTocFromNode(toc, { dir: doc.dir }));
	} else {
		console.warn('Auto-creating ToC');
		zip.file('EPUB/nav.xhtml', makeToc(doc, { title: doc.title }));
	}
	zip.file('EPUB/index.xhtml', xml.toString());
	zip.file('EPUB/base.css', baseCss);
	for (const p of assets) {
		if (path.isAbsolute(p) || p.match(/(^|\/)\.{2}($|\/)/)) { continue; }

		let ab;
		if (base instanceof URL) {
			const url = new URL(p, base);
			try {
				const res = await fetch(url.href);
				ab = await res.arrayBuffer();
			} catch (err) {
				console.warn(err);
			}
		} else {
			const source = p;
			try {
				ab = await tjs.readFile(source);
			} catch (err) {
				console.warn(`Error at "${p}":`, err);
			}
		}
		if (ab) {
			console.log('Write:', p);
			zip.file(`EPUB/${p}`, ab);
		}
	}

	console.log('Zipping up...');
	await tjs.writeFile(epubFile, await zip.generateAsync({
		type: 'uint8array',
		compression: 'DEFLATE',
		compressionOptions: { level: 9 },
	}));
}

function printHelp() {
	console.error(`Usage: ${tjs.args[0]} -o output.epub [-i input.html|-u https://www.w3.org/TR/epub-33/]`);
}

try {
	const { url, input, output, help } = getopts(tjs.args.slice(1), {
		alias: { h: 'help', u: 'url', i: 'input', o: 'output' },
		string: ['url', 'input', 'output'],
		boolean: ['help'],
	});

	if (help) {
		printHelp();
		tjs.exit(0);
	}

	let html, base;
	if (!output || (!input && !url)) {
		printHelp();
		tjs.exit(1);
	} else if (input) {
		base = path.dirname(input);
		html = new TextDecoder().decode(await tjs.readFile(input));
	} else if (url) {
		base = new URL(url);
		const res = await fetch(url);
		html = await res.text();
	}
	await makeEpub(html, output, { base });
} catch (err) {
	console.error(err);
	tjs.exit(1);
}
