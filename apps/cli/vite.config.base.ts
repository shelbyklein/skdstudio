import { cpSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import semver from 'semver';
import { defineConfig } from 'vite';

const __dirname = import.meta.dirname;
const packageJson = createRequire( import.meta.url )( './package.json' ) as {
	dependencies?: Record< string, string >;
	engines?: { node?: string };
	version: string;
};

const nodeBuiltinExternals: RegExp[] = [
	/^node:/,
	/^(path|fs|os|child_process|crypto|http|https|http2|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants|tls|domain|dns|async_hooks)$/,
	/^fs\/promises$/,
	/^dns\/promises$/,
];

const packageJsonDependencies = Object.keys( packageJson.dependencies || {} );
const minimumNodeVersionRange = packageJson.engines?.node;

if ( typeof minimumNodeVersionRange !== 'string' || minimumNodeVersionRange.length === 0 ) {
	throw new Error( 'apps/cli/package.json must define engines.node as a non-empty string.' );
}

const minimumNodeVersion = semver.minVersion( minimumNodeVersionRange )?.version;

if ( ! minimumNodeVersion ) {
	throw new Error(
		`Invalid engines.node range in apps/cli/package.json: ${ minimumNodeVersionRange }`
	);
}

const bundledWpFilesPath = resolve( __dirname, '..', '..', 'wp-files' );
const phpSourceCodePath = resolve( __dirname, 'php' );

export const baseConfig = defineConfig( {
	oxc: {
		target: `node${ semver.major( minimumNodeVersion ) }`,
	},
	plugins: [
		{
			name: 'write-dist-extras',
			apply: 'build',
			writeBundle( options ) {
				const outDir = options.dir ?? resolve( __dirname, 'dist/cli' );
				mkdirSync( outDir, { recursive: true } );
				writeFileSync(
					resolve( outDir, 'package.json' ),
					JSON.stringify( { type: 'module' }, null, 2 ) + '\n'
				);
				if ( existsSync( phpSourceCodePath ) ) {
					cpSync( phpSourceCodePath, resolve( outDir, 'php' ), { recursive: true } );
				}
				if ( existsSync( bundledWpFilesPath ) ) {
					cpSync( bundledWpFilesPath, resolve( outDir, 'wp-files' ), { recursive: true } );
				}
			},
		},
	],
	build: {
		emptyOutDir: true,
		lib: {
			entry: {
				main: resolve( __dirname, 'index.ts' ),
				'process-manager-daemon': resolve( __dirname, 'process-manager-daemon.ts' ),
				'proxy-daemon': resolve( __dirname, 'proxy-daemon.ts' ),
				'playground-server-child': resolve( __dirname, 'playground-server-child.ts' ),
				'php-server-child': resolve( __dirname, 'php-server-child.ts' ),
			},
			name: 'StudioCLI',
			formats: [ 'es' ],
		},
		outDir: 'dist/cli',
		target: 'node22',
		rolldownOptions: {
			output: {
				format: 'es',
				entryFileNames: '[name].mjs',
				chunkFileNames: '[name]-[hash].mjs',
				// Some bundled CommonJS dependencies (e.g. `lockfile`, `debug`) call
				// `require( ... )` for Node built-ins at module init. Rolldown (the
				// default bundler in Vite 8) emits a shim that throws when those calls
				// run in an ESM output (`.mjs`), since ESM has no implicit `require`.
				// Provide a real `require` per chunk via `createRequire` so the shim
				// uses it instead of throwing. `main.mjs` additionally gets a shebang so
				// the npm-published bundle can be executed directly as a CLI (harmless in
				// other builds — Node ignores it when the file is run via `node main.mjs`).
				banner: ( chunk ) => {
					const requireShim =
						'import { createRequire as __studioCreateRequire } from "node:module"; const require = __studioCreateRequire(import.meta.url);';
					return chunk.fileName === 'main.mjs'
						? `#!/usr/bin/env node\n${ requireShim }`
						: requireShim;
				},
			},
			external: ( id ) => {
				// Bundle the `@wp-playground/blueprints/blueprint-schema-validator` module since we've defined
				// that module ourselves
				if ( id.includes( 'blueprint-schema-validator' ) ) {
					return false;
				}

				if ( nodeBuiltinExternals.some( ( pattern ) => pattern.test( id ) ) ) {
					return true;
				}

				return packageJsonDependencies.some( ( dep ) => id === dep || id.startsWith( dep + '/' ) );
			},
		},
		commonjsOptions: {
			ignoreDynamicRequires: true,
		},
		sourcemap: false,
		minify: false,
	},
	resolve: {
		alias: {
			cli: resolve( __dirname, '.' ),
			'@studio/common': resolve( __dirname, '../../packages/common' ),
			'@wp-playground/blueprints/blueprint-schema-validator': resolve(
				__dirname,
				'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
		conditions: [ 'node' ],
		mainFields: [ 'main' ],
	},
	define: {
		__MINIMUM_NODE_VERSION__: JSON.stringify( minimumNodeVersion ),
		__STUDIO_CLI_VERSION__: JSON.stringify( packageJson.version ),
	},
} );
