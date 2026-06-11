import 'core-js/modules/web.immediate';

import getopts from 'tjs:getopts';
import path from 'tjs:path';

import JSZip from 'jszip';
import { DOMParser } from 'linkedom';
import { Readability } from '@mozilla/readability';

import baseCss from './base.scss';
import fictionCss from './fiction.scss';
import { version } from '../package.json';

import { makeLink } from './domUtils.mjs';

const mimeTypes = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.css': 'text/css',
	'.xhtml': 'application/xhtml+xml',
};

const ua = `epublic/${version} (+https://github.com/I-asked/epublic/issues)`;

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

	head.appendChild(makeLink(xml, { href: 'base.css' }));

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

	const makeItem = (document, { href }) => {
		const el = xml.createElement('item');
		el.setAttribute('id', `asset-u${crypto.randomUUID()}`);
		el.setAttribute('href', href);
		el.setAttribute('media-type', mimeTypes[path.extname(href)] ?? 'application/octet-stream');

		return el;
	}

	const mf = xml.querySelector('manifest');
	if (opt.assets) {
		let i = 0;
		for (const p of opt.assets) {
			if (path.isAbsolute(p)) { continue; }
			mf.appendChild(makeItem(xml, { href: p }));
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

	return xml;
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

	return xml;
}

async function makeEpub(html, epubFile, { base, css, fiction, level }) {
	level = parseInt(level || '6');
	if (level < 0 || level > 9) {
		throw 'level must be 0..9';
	}

	console.log('Parsing DOM...')
	const document = (new DOMParser).parseFromString(html, 'text/html');

	console.log('Applying readability tweaks...')
	const doc = new Readability(document, { serializer: (el) => el }).parse();

	console.log('Populating the spine...')
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

	const head = xml.querySelector('head');

	const allAssets = [...assets];
	if (fiction) {
		allAssets.push('fiction.css');
		head.appendChild(makeLink(xml, { href: 'fiction.css' }));
	}
	if (css) {
		allAssets.push('user.css');
		head.appendChild(makeLink(xml, { href: 'user.css' }));
	}
	zip.file('EPUB/package.opf', makePackage(doc, { assets: allAssets }));
	let tocXml;
	if (toc) {
		tocXml = makeTocFromNode(toc, { dir: doc.dir });
	} else {
		console.warn('Auto-creating ToC');
		tocXml = makeToc(doc, { title: doc.title });
	}
	const tocHead = tocXml.querySelector('head');

	zip.file('EPUB/base.css', baseCss);
	if (fiction) {
		tocHead.appendChild(makeLink(tocXml, { href: 'fiction.css' }));
		zip.file('EPUB/fiction.css', fictionCss);
	}
	if (css) {
		tocHead.appendChild(makeLink(tocXml, { href: 'user.css' }));
		try {
			zip.file('EPUB/user.css', await tjs.readFile(css));
		} catch (err) {
			console.warn(`Failed to load user stylesheet "${css}":`, err);
		}
	}

	for (const p of assets) {
		if (path.isAbsolute(p) || p.match(/(^|\/)\.{2}($|\/)/)) { continue; }

		let ab;
		if (base instanceof URL) {
			const url = new URL(p, base);
			try {
				console.log(`Fetching resource at: ${url}`);
				const res = await fetch(url.href, { headers: { 'User-Agent': ua } });
				ab = await res.arrayBuffer();
			} catch (err) {
				console.warn(err);
			}
		} else {
			const source = path.resolve(base, p);
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

	zip.file('EPUB/nav.xhtml', tocXml.toString());
	zip.file('EPUB/index.xhtml', xml.toString());

	console.log('Zipping up...');
	await tjs.writeFile(epubFile, await zip.generateAsync({
		type: 'uint8array',
		compression: level > 0
			? 'DEFLATE'
			: 'STORE',
		compressionOptions: { level },
	}));

	console.log('All done!');
}

function printHelp() {
	console.error(`Usage: ${tjs.args[0]} [-h] [-l 0..9] [-f none|fiction] [-c style.css] -o output.epub [-i input.html|-u https://www.w3.org/TR/epub-33/]

Options:
	-o OUTPUT
		path to the resulting epub
	-i INPUT
		path to the pre-fetched webpage
	-u URL
		url of the webpage to fetch
	-c CSS
		append contents of CSS to the embedded stylesheet
	-l LEVEL
		FLATE compression level (or 0 for store; defaults to 6)
	-f FORMAT
		use special formatting (available: [fiction, none]; defaults to none)

Flags:
	-h
		display this help and exit`);
}

try {
	const { url, input, output, css, level, format, help } = getopts(tjs.args.slice(1), {
		alias: { h: 'help', u: 'url', i: 'input', o: 'output', c: 'css', f: 'format', l: 'level' },
		string: ['url', 'input', 'output', 'css', 'format', 'level'],
		boolean: ['help'],
	});

	if (help) {
		printHelp();
		tjs.exit(0);
	}

	if (format && format !== 'fiction' && format !== 'none') {
		console.error('Unsupported format:', format);
		printHelp();
		tjs.exit(1);
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
		console.log('Fetching url...');
		const res = await fetch(url, { headers: { 'Accept': 'text/html', 'User-Agent': ua } });
		html = await res.text();
	}
	await makeEpub(html, output, { base, css, fiction: (format === 'fiction'), level });
} catch (err) {
	console.error(err);
	tjs.exit(1);
}
