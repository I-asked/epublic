import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import poly from 'rollup-plugin-polyfill-node';
import scss from 'rollup-plugin-scss';

const tjsImports = [
	'tjs:path',
	'tjs:sqlite',
	'tjs:ffi',
	'tjs:getopts',
];

export default [
	{
		input: 'src/main.mjs',
		output: { file: 'lib/epublic.js', format: 'es' },
		plugins: [commonjs(), poly(), resolve(), scss({ output: false })],
		external: [...tjsImports],
	},
];
