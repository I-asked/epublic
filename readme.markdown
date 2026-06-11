# epublic

epublic - tiny HTML-to-EPUB converter using [Readability](https://github.com/mozilla/readability) (as featured in Firefox Reader View); compiles down to a single static executable using [txiki.js](https://github.com/saghul/txiki.js).

## usage

- by URL:
	```
	$ epublic -u https://example.com -o example.epub
	```
- from filesystem:
	```
	$ epublic -i path/to/index.html -o example.epub
	```

### build

`pnpm` (and thus also `node`) must be available to build epublic.

build [txiki](https://github.com/saghul/txiki.js) first; then, with txiki installed somewhere in `PATH`:

```
$ pnpm run build
# install -psm755 ./epublic -t /usr/local/bin
```
