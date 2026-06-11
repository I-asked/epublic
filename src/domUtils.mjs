export function makeLink(document, { type, href, rel }) {
	type ??= 'text/css';
	rel ??= 'stylesheet';

	const link = document.createElement('link');
	link.setAttribute('type', type);
	link.setAttribute('href', href);
	link.setAttribute('rel', rel);

	return link;
}
