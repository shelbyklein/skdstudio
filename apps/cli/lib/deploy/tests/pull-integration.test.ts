/**
 * @vitest-environment node
 *
 * Runs real pulls against a stand-in for the server, the same way the deploy
 * tests do: `ssh` and `rsync` are replaced on PATH with scripts that act
 * locally, so the generated bash really executes and its output is really
 * parsed. The local WP-CLI calls are mocked, because the pieces worth testing
 * here are the direction of the sync, what it refuses to overwrite, and the
 * URL rewrite applied to the dump on its way in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pullSite } from 'cli/lib/deploy/pull-manager';
import { Logger } from 'cli/logger';
import type { DeployTarget } from '@studio/common/lib/deploy-target';

const runWpCliCommand = vi.hoisted( () => vi.fn() );
vi.mock( 'cli/lib/run-wp-cli-command', () => ( { runWpCliCommand } ) );

const updateSiteAdminUsername = vi.hoisted( () => vi.fn() );
vi.mock( 'cli/lib/cli-config/sites', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/cli-config/sites') >() ),
	updateSiteAdminUsername,
} ) );

const tmpDirPath = vi.hoisted( () => ( { value: '' } ) );
vi.mock( 'cli/lib/native-php/tmp-dir', () => ( {
	getFullyResolvedTmpDirPath: () => tmpDirPath.value,
} ) );

const REMOTE_URL = 'https://example.com';
const LOCAL_URL = 'http://localhost:8881';

let root: string;
let binDir: string;
let sitePath: string;
let remotePath: string;
let originalPath: string | undefined;
/** SQL handed to `wp sqlite import`, captured from the staged file. */
let importedSql: string | undefined;

function writeExecutable( file: string, contents: string ): void {
	fs.writeFileSync( file, contents, 'utf8' );
	fs.chmodSync( file, 0o755 );
}

function installFakeSsh(): void {
	writeExecutable( path.join( binDir, 'ssh' ), '#!/bin/bash\nexec /bin/bash -s\n' );
}

function installFakeRsync(): void {
	writeExecutable(
		path.join( binDir, 'rsync' ),
		`#!/bin/bash
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    -e) shift 2 ;;
    *) args+=("\${1#*:}"); shift ;;
  esac
done
exec /usr/bin/rsync "\${args[@]}"
`
	);
}

function installFakeWp(): void {
	writeExecutable(
		path.join( binDir, 'wp' ),
		`#!/bin/bash
for arg in "$@"; do
  if [ "$arg" = "version" ]; then echo "6.8"; exit 0; fi
done
# 'db export <file>' hands back the live database.
prev=""
for arg in "$@"; do
  if [ "$prev" = "export" ]; then cp "${ root }/live.sql" "$arg"; fi
  prev="$arg"
done
exit 0
`
	);
}

/** Stands in for the local WP-CLI: records the staged dump and the options set. */
function mockLocalWpCli(): void {
	runWpCliCommand.mockImplementation( ( site: { path: string }, args: string[] ) => {
		if ( args[ 0 ] === 'sqlite' && args[ 1 ] === 'import' ) {
			importedSql = fs.readFileSync( path.join( site.path, args[ 2 ] ), 'utf8' );
		}
		const stdout = args[ 0 ] === 'user' && args[ 1 ] === 'list' ? 'liveadmin\n' : '';
		return Promise.resolve( {
			response: {
				exitCode: Promise.resolve( 0 ),
				stdoutText: Promise.resolve( stdout ),
				stderrText: Promise.resolve( '' ),
			},
			[ Symbol.asyncDispose ]: () => Promise.resolve(),
		} );
	} );
}

function makeTarget( overrides: Partial< DeployTarget > = {} ): DeployTarget {
	return { host: 'example-server', remotePath, remoteUrl: REMOTE_URL, ...overrides };
}

function pullOptions( overrides: Record< string, unknown > = {} ) {
	return {
		site: {
			id: 'site-1',
			name: 'Test site',
			path: sitePath,
			port: 8881,
			url: LOCAL_URL,
			phpVersion: '8.4',
		},
		target: makeTarget(),
		includeDatabase: true,
		deleteRemoved: true,
		dryRun: false,
		logger: new Logger(),
		...overrides,
	} as Parameters< typeof pullSite >[ 0 ];
}

beforeEach( () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-test-' ) );
	binDir = path.join( root, 'bin' );
	sitePath = path.join( root, 'site' );
	remotePath = path.join( root, 'remote' );
	tmpDirPath.value = root;
	importedSql = undefined;

	fs.mkdirSync( binDir, { recursive: true } );

	// The local site, with the Studio-only files a pull must not disturb.
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'database' ), { recursive: true } );
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'mu-plugins' ), { recursive: true } );
	fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), '<?php // sqlite config' );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'db.php' ), '<?php // sqlite drop-in' );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ), 'local-db' );
	fs.writeFileSync(
		path.join( sitePath, 'wp-content', 'mu-plugins', '99-studio-loader.php' ),
		'<?php // local loader'
	);

	// The live site.
	fs.mkdirSync( path.join( remotePath, 'wp-content', 'themes', 'livetheme' ), { recursive: true } );
	fs.writeFileSync( path.join( remotePath, 'index.php' ), '<?php // live front controller' );
	fs.writeFileSync( path.join( remotePath, 'wp-config.php' ), "<?php define('DB_NAME','livedb');" );
	fs.writeFileSync(
		path.join( remotePath, 'wp-content', 'themes', 'livetheme', 'style.css' ),
		'body{color:red}'
	);

	fs.writeFileSync(
		path.join( root, 'live.sql' ),
		[
			"INSERT INTO `wp_options` VALUES (1,'siteurl','https://example.com','yes');",
			"INSERT INTO `wp_options` VALUES (2,'home','https://example.com','yes');",
			`INSERT INTO \`wp_options\` VALUES (3,'w',' a:1:{s:3:"url";s:19:"https://example.com";}','yes');`,
		].join( '\n' ),
		'utf8'
	);

	installFakeSsh();
	installFakeRsync();
	installFakeWp();
	mockLocalWpCli();

	originalPath = process.env.PATH;
	process.env.PATH = `${ binDir }:${ originalPath }`;
} );

afterEach( () => {
	process.env.PATH = originalPath;
	fs.rmSync( root, { recursive: true, force: true } );
	vi.clearAllMocks();
} );

describe( 'pullSite', () => {
	it( 'brings the live files down', async () => {
		const result = await pullSite( pullOptions() );

		expect( result.filesTransferred ).toBeGreaterThan( 0 );
		expect( fs.existsSync( path.join( sitePath, 'index.php' ) ) ).toBe( true );
		expect(
			fs.readFileSync(
				path.join( sitePath, 'wp-content', 'themes', 'livetheme', 'style.css' ),
				'utf8'
			)
		).toBe( 'body{color:red}' );
	} );

	it( 'keeps the local wp-config.php instead of the live one', async () => {
		await pullSite( pullOptions() );

		expect( fs.readFileSync( path.join( sitePath, 'wp-config.php' ), 'utf8' ) ).toContain(
			'sqlite config'
		);
	} );

	it( 'keeps the local SQLite database and drop-in', async () => {
		await pullSite( pullOptions() );

		expect( fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) ) ).toBe( true );
		expect(
			fs.readFileSync( path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ), 'utf8' )
		).toBe( 'local-db' );
	} );

	it( 'keeps the Studio mu-plugin loader', async () => {
		await pullSite( pullOptions() );

		expect(
			fs.existsSync( path.join( sitePath, 'wp-content', 'mu-plugins', '99-studio-loader.php' ) )
		).toBe( true );
	} );

	it( 'brings down plugin files in directories named like Studio internals', async () => {
		const vendorDir = path.join(
			remotePath,
			'wp-content',
			'plugins',
			'migration',
			'lib',
			'servmask',
			'database'
		);
		const cacheDir = path.join( remotePath, 'wp-content', 'plugins', 'speedy', 'cache' );
		fs.mkdirSync( vendorDir, { recursive: true } );
		fs.mkdirSync( cacheDir, { recursive: true } );
		fs.writeFileSync( path.join( vendorDir, 'class-db.php' ), '<?php // required at boot' );
		fs.writeFileSync( path.join( cacheDir, 'engine.php' ), '<?php' );

		await pullSite( pullOptions() );

		const localPlugins = path.join( sitePath, 'wp-content', 'plugins' );
		expect(
			fs.existsSync( path.join( localPlugins, 'migration/lib/servmask/database/class-db.php' ) )
		).toBe( true );
		expect( fs.existsSync( path.join( localPlugins, 'speedy/cache/engine.php' ) ) ).toBe( true );
	} );

	it( 'removes local files the live site does not have', async () => {
		const stale = path.join( sitePath, 'wp-content', 'themes', 'localtheme' );
		fs.mkdirSync( stale, { recursive: true } );
		fs.writeFileSync( path.join( stale, 'style.css' ), 'local' );

		await pullSite( pullOptions() );

		expect( fs.existsSync( stale ) ).toBe( false );
	} );

	it( 'keeps local files when deleting is turned off', async () => {
		const stale = path.join( sitePath, 'wp-content', 'themes', 'localtheme' );
		fs.mkdirSync( stale, { recursive: true } );
		fs.writeFileSync( path.join( stale, 'style.css' ), 'local' );

		await pullSite( pullOptions( { deleteRemoved: false } ) );

		expect( fs.existsSync( stale ) ).toBe( true );
	} );

	it( 'rewrites the live URL to the local one before importing', async () => {
		const result = await pullSite( pullOptions() );

		expect( result.databasePulled ).toBe( true );
		expect( importedSql ).toBeDefined();
		expect( importedSql ).not.toContain( REMOTE_URL );
		expect( importedSql ).toContain( `'siteurl','${ LOCAL_URL }'` );
		// The serialized length follows the shorter local URL.
		expect( importedSql ).toContain( 's:21:"http://localhost:8881"' );
		expect( result.urlReplacements ).toBeGreaterThan( 0 );
	} );

	it( 'rewrites the other scheme spelling of the live address too', async () => {
		// Content saved before a site moved to HTTPS keeps http:// links, and CSS
		// often never gets revisited. Missing those leaves a local copy loading
		// fonts and images from production.
		fs.writeFileSync(
			path.join( root, 'live.sql' ),
			"INSERT INTO `wp_options` VALUES (1,'css','src:url(http://example.com/font.woff2)','yes');",
			'utf8'
		);

		await pullSite( pullOptions() );

		expect( importedSql ).not.toContain( 'http://example.com' );
		expect( importedSql ).toContain( `${ LOCAL_URL }/font.woff2` );
	} );

	it( 'points auto-login at an administrator from the live database', async () => {
		const result = await pullSite( pullOptions() );

		expect( result.adminUsername ).toBe( 'liveadmin' );
		expect( runWpCliCommand ).toHaveBeenCalledWith(
			expect.anything(),
			expect.arrayContaining( [ 'option', 'update', 'studio_admin_username', 'liveadmin' ] ),
			expect.anything()
		);
	} );

	it( 'records that administrator on the site, so the next start can configure it', async () => {
		// The server forces the stored credentials onto this account every time
		// the site starts. Leaving the old name there makes startup fail against
		// a user the incoming database does not have.
		await pullSite( pullOptions() );

		expect( updateSiteAdminUsername ).toHaveBeenCalledWith( 'site-1', 'liveadmin' );
	} );

	it( 'leaves the local database alone when asked for files only', async () => {
		const result = await pullSite( pullOptions( { includeDatabase: false } ) );

		expect( result.databasePulled ).toBe( false );
		expect( importedSql ).toBeUndefined();
		expect( fs.existsSync( path.join( sitePath, 'index.php' ) ) ).toBe( true );
	} );

	it( 'changes nothing locally on a dry run', async () => {
		const result = await pullSite( pullOptions( { dryRun: true } ) );

		expect( result.dryRun ).toBe( true );
		expect( fs.existsSync( path.join( sitePath, 'index.php' ) ) ).toBe( false );
		expect( importedSql ).toBeUndefined();
	} );

	it( 'refuses a remote directory that is not WordPress', async () => {
		const empty = path.join( root, 'empty' );
		fs.mkdirSync( empty, { recursive: true } );

		await expect(
			pullSite( pullOptions( { target: makeTarget( { remotePath: empty } ) } ) )
		).rejects.toThrow( /does not look like a WordPress installation/i );
	} );

	it( 'refuses a remote directory that does not exist', async () => {
		await expect(
			pullSite( pullOptions( { target: makeTarget( { remotePath: path.join( root, 'nope' ) } ) } ) )
		).rejects.toThrow( /does not exist/i );
	} );
} );
