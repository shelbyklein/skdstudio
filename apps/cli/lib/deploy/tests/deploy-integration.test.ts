/**
 * @vitest-environment node
 *
 * Drives a real deploy against a stand-in for the server.
 *
 * `ssh` and `rsync` are replaced on PATH with scripts that act locally: the
 * fake ssh runs the piped bash against a directory playing the part of the
 * remote host, and the fake rsync strips the transport flags and copies on
 * disk. That exercises the bash Studio generates and the output it parses,
 * which is where the real risk in this feature lives, without needing a server.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deploySite, getRemoteBackupDir } from 'cli/lib/deploy/deploy-manager';
import { Logger } from 'cli/logger';
import type { DeployTarget } from '@studio/common/lib/deploy-target';
import type { RemoteEnvironment } from 'cli/lib/deploy/remote-scripts';

const exportDatabaseToFile = vi.hoisted( () => vi.fn() );
vi.mock( 'cli/lib/import-export/export/export-database', () => ( { exportDatabaseToFile } ) );

const tmpDirPath = vi.hoisted( () => ( { value: '' } ) );
vi.mock( 'cli/lib/native-php/tmp-dir', () => ( {
	getFullyResolvedTmpDirPath: () => tmpDirPath.value,
} ) );

const LOCAL_URL = 'http://localhost:8881';

let root: string;
let binDir: string;
let sitePath: string;
let remotePath: string;
let originalPath: string | undefined;

function writeExecutable( file: string, contents: string ): void {
	fs.writeFileSync( file, contents, 'utf8' );
	fs.chmodSync( file, 0o755 );
}

/**
 * The stand-in for ssh. It ignores the destination and connection flags and
 * runs whatever bash arrives on stdin, so the generated script really executes.
 */
function installFakeSsh(): void {
	writeExecutable(
		path.join( binDir, 'ssh' ),
		`#!/bin/bash
# Consume the flags and the destination; the script itself arrives on stdin.
# The "server" gets its own home directory so backups never land in the real one.
export HOME="${ root }/remote-home"
exec /bin/bash -s
`
	);
}

/** The stand-in for rsync: drops -e and the host prefix, then copies for real. */
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

/**
 * A PHP binary to stand in for the server's. Resolved once, before PATH is
 * rewritten, and falling back to the one Studio installs for native sites so
 * the fallback case still runs on a machine with no system PHP.
 */
function findRealPhp(): string | undefined {
	for ( const dir of ( process.env.PATH ?? '' ).split( path.delimiter ) ) {
		const candidate = dir && path.join( dir, 'php' );
		if ( candidate && fs.existsSync( candidate ) ) {
			return candidate;
		}
	}

	const bundled = path.join( os.homedir(), '.studio', 'php-bin' );
	if ( fs.existsSync( bundled ) ) {
		for ( const entry of fs.readdirSync( bundled ) ) {
			const candidate = path.join( bundled, entry, 'php' );
			if ( fs.existsSync( candidate ) ) {
				return candidate;
			}
		}
	}

	return undefined;
}

const REAL_PHP = findRealPhp();

/** A WP-CLI stand-in that records what it was asked to do. */
function installFakeWp( behaviour: 'working' | 'absent' | 'broken' ): void {
	const wpPath = path.join( binDir, 'wp' );
	if ( behaviour === 'absent' ) {
		fs.rmSync( wpPath, { force: true } );
		return;
	}

	writeExecutable(
		wpPath,
		`#!/bin/bash
log="${ root }/wp-calls.log"
echo "$@" >> "$log"
${ behaviour === 'broken' ? 'exit 1' : '' }
for arg in "$@"; do
  if [ "$arg" = "version" ]; then echo "6.8"; exit 0; fi
done
# 'db import <file>' records the dump it was handed; 'db export <file>' writes one.
prev=""
for arg in "$@"; do
  if [ "$prev" = "import" ] && [ -f "$arg" ]; then cp "$arg" "${ root }/imported.sql"; fi
  if [ "$prev" = "export" ]; then echo "-- live dump" > "$arg"; fi
  prev="$arg"
done
exit 0
`
	);
}

function makeTarget( overrides: Partial< DeployTarget > = {} ): DeployTarget {
	return {
		host: 'example-server',
		remotePath,
		remoteUrl: 'https://example.com',
		...overrides,
	};
}

function makeSite() {
	return {
		id: 'site-1',
		name: 'Test site',
		path: sitePath,
		port: 8881,
		url: LOCAL_URL,
		phpVersion: '8.4',
	} as never;
}

function deployOptions( overrides: Record< string, unknown > = {} ) {
	return {
		site: makeSite(),
		target: makeTarget(),
		includeDatabase: false,
		backupRemoteDatabase: false,
		dryRun: false,
		logger: new Logger(),
		...overrides,
	} as Parameters< typeof deploySite >[ 0 ];
}

beforeEach( () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-deploy-test-' ) );
	binDir = path.join( root, 'bin' );
	sitePath = path.join( root, 'site' );
	remotePath = path.join( root, 'remote' );
	tmpDirPath.value = root;

	fs.mkdirSync( binDir, { recursive: true } );
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'themes', 'mytheme' ), { recursive: true } );
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'database' ), { recursive: true } );
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'plugins', 'sqlite-database-integration' ), {
		recursive: true,
	} );
	fs.mkdirSync( path.join( remotePath, 'wp-content' ), { recursive: true } );

	fs.writeFileSync( path.join( sitePath, 'index.php' ), '<?php // front controller' );
	fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), "<?php define('DB_NAME','local');" );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'db.php' ), '<?php // sqlite drop-in' );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ), 'binary' );
	fs.writeFileSync(
		path.join( sitePath, 'wp-content', 'plugins', 'sqlite-database-integration', 'load.php' ),
		'<?php'
	);
	fs.writeFileSync(
		path.join( sitePath, 'wp-content', 'themes', 'mytheme', 'style.css' ),
		'body{}'
	);
	fs.writeFileSync(
		path.join( remotePath, 'wp-config.php' ),
		"<?php define('DB_NAME','livedb'); define('DB_USER','liveuser'); define('DB_PASSWORD',\"p'ass\\\\word\"); define('DB_HOST','127.0.0.1:3307'); $table_prefix = 'wp_';"
	);

	installFakeSsh();
	installFakeRsync();
	installFakeWp( 'working' );

	originalPath = process.env.PATH;
	process.env.PATH = `${ binDir }:${ originalPath }`;

	exportDatabaseToFile.mockImplementation( async ( _site: unknown, destination: string ) => {
		fs.writeFileSync(
			destination,
			[
				'DROP TABLE IF EXISTS `wp_options`;',
				"INSERT INTO `wp_options` VALUES (1,'siteurl','http://localhost:8881','yes');",
				"INSERT INTO `wp_options` VALUES (2,'home','http://localhost:8881','yes');",
				`INSERT INTO \`wp_options\` VALUES (3,'widget',' a:1:{s:3:"url";s:21:"http://localhost:8881";}','yes');`,
			].join( '\n' ),
			'utf8'
		);
	} );
} );

afterEach( () => {
	process.env.PATH = originalPath;
	fs.rmSync( root, { recursive: true, force: true } );
	vi.clearAllMocks();
} );

describe( 'deploySite', () => {
	it( 'copies the site files to the server', async () => {
		const result = await deploySite( deployOptions() );

		expect( result.filesTransferred ).toBeGreaterThan( 0 );
		expect( fs.existsSync( path.join( remotePath, 'index.php' ) ) ).toBe( true );
		expect(
			fs.existsSync( path.join( remotePath, 'wp-content', 'themes', 'mytheme', 'style.css' ) )
		).toBe( true );
	} );

	it( 'never overwrites the server wp-config.php', async () => {
		await deploySite( deployOptions() );

		expect( fs.readFileSync( path.join( remotePath, 'wp-config.php' ), 'utf8' ) ).toContain(
			'livedb'
		);
	} );

	it( 'leaves the SQLite integration behind', async () => {
		await deploySite( deployOptions() );

		expect( fs.existsSync( path.join( remotePath, 'wp-content', 'db.php' ) ) ).toBe( false );
		expect( fs.existsSync( path.join( remotePath, 'wp-content', 'database' ) ) ).toBe( false );
		expect(
			fs.existsSync(
				path.join( remotePath, 'wp-content', 'plugins', 'sqlite-database-integration' )
			)
		).toBe( false );
	} );

	it( 'leaves the Studio mu-plugin loader behind', async () => {
		const loaderDir = path.join( sitePath, 'wp-content', 'mu-plugins' );
		fs.mkdirSync( loaderDir, { recursive: true } );
		fs.writeFileSync( path.join( loaderDir, '99-studio-loader.php' ), '<?php // points at /tmp' );
		fs.writeFileSync( path.join( loaderDir, 'my-own-plugin.php' ), '<?php' );

		await deploySite( deployOptions() );

		const remoteMuPlugins = path.join( remotePath, 'wp-content', 'mu-plugins' );
		expect( fs.existsSync( path.join( remoteMuPlugins, '99-studio-loader.php' ) ) ).toBe( false );
		expect( fs.existsSync( path.join( remoteMuPlugins, 'my-own-plugin.php' ) ) ).toBe( true );
	} );

	it( 'keeps plugin files in directories named like Studio internals', async () => {
		// A bare `database` or `cache` exclude matches at any depth in rsync, and
		// these are ordinary names inside plugins. Losing one of them is what
		// took a real deployed site down.
		const vendorDir = path.join(
			sitePath,
			'wp-content',
			'plugins',
			'migration',
			'lib',
			'servmask',
			'database'
		);
		const cacheDir = path.join( sitePath, 'wp-content', 'plugins', 'speedy', 'cache' );
		fs.mkdirSync( vendorDir, { recursive: true } );
		fs.mkdirSync( cacheDir, { recursive: true } );
		fs.writeFileSync( path.join( vendorDir, 'class-db.php' ), '<?php // required at boot' );
		fs.writeFileSync( path.join( cacheDir, 'engine.php' ), '<?php' );
		fs.writeFileSync(
			path.join( sitePath, 'wp-content', 'plugins', 'migration', 'db.php' ),
			'<?php // plugin file, not the drop-in'
		);

		await deploySite( deployOptions() );

		const remotePlugins = path.join( remotePath, 'wp-content', 'plugins' );
		expect(
			fs.existsSync( path.join( remotePlugins, 'migration/lib/servmask/database/class-db.php' ) )
		).toBe( true );
		expect( fs.existsSync( path.join( remotePlugins, 'speedy/cache/engine.php' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( remotePlugins, 'migration/db.php' ) ) ).toBe( true );
		// The real drop-in, at the root of wp-content, still goes nowhere.
		expect( fs.existsSync( path.join( remotePath, 'wp-content', 'db.php' ) ) ).toBe( false );
	} );

	it( 'honours .deployignore', async () => {
		fs.writeFileSync( path.join( sitePath, '.deployignore' ), 'wp-content/themes/mytheme\n' );

		await deploySite( deployOptions() );

		expect( fs.existsSync( path.join( remotePath, 'index.php' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( remotePath, 'wp-content', 'themes', 'mytheme' ) ) ).toBe(
			false
		);
	} );

	it( 'writes nothing to the server on a dry run', async () => {
		const result = await deploySite( deployOptions( { dryRun: true } ) );

		expect( result.dryRun ).toBe( true );
		expect( fs.existsSync( path.join( remotePath, 'index.php' ) ) ).toBe( false );
	} );

	it( 'imports a database rewritten to the destination URL', async () => {
		const result = await deploySite( deployOptions( { includeDatabase: true } ) );

		expect( result.databasePushed ).toBe( true );
		const imported = fs.readFileSync( path.join( root, 'imported.sql' ), 'utf8' );
		expect( imported ).not.toContain( LOCAL_URL );
		expect( imported ).toContain( "'siteurl','https://example.com'" );
		// The serialized length is restated from 21 to 19 bytes.
		expect( imported ).toContain( 's:19:"https://example.com"' );
	} );

	it( 'leaves rewrite rules for WordPress to rebuild instead of flushing them without plugins', async () => {
		await deploySite( deployOptions( { includeDatabase: true } ) );

		const wpCalls = fs.readFileSync( path.join( root, 'wp-calls.log' ), 'utf8' );
		expect( wpCalls ).toContain( 'option delete rewrite_rules' );
		expect( wpCalls ).not.toContain( 'rewrite flush' );
	} );

	it( 'backs up the live database before replacing it', async () => {
		const result = await deploySite(
			deployOptions( { includeDatabase: true, backupRemoteDatabase: true } )
		);

		const backupDir = path.join(
			root,
			'remote-home',
			'.studio-deploy',
			remotePath.replace( /^\/+/, '' ).replace( /[^A-Za-z0-9._-]+/g, '-' )
		);
		expect( path.dirname( result.remoteBackupPath! ) ).toBe( backupDir );
		expect( path.basename( result.remoteBackupPath! ) ).toMatch( /^before-.*\.sql$/ );
		// Never inside the web root, where the web server would hand it out.
		expect( path.relative( remotePath, result.remoteBackupPath! ).startsWith( '..' ) ).toBe( true );
		expect( fs.existsSync( result.remoteBackupPath! ) ).toBe( true );
		expect( fs.statSync( backupDir ).mode & 0o777 ).toBe( 0o700 );
		expect( fs.statSync( result.remoteBackupPath! ).mode & 0o777 ).toBe( 0o600 );
		const wpCalls = fs.readFileSync( path.join( root, 'wp-calls.log' ), 'utf8' );
		expect( wpCalls ).toContain( 'db export' );
		expect( wpCalls.indexOf( 'db export' ) ).toBeLessThan( wpCalls.indexOf( 'db import' ) );
	} );

	it.skipIf( ! REAL_PHP )(
		'falls back to the mysql client when the server has no WP-CLI',
		async () => {
			installFakeWp( 'absent' );
			// The absolute path matters: the fake bin directory comes first on PATH,
			// so a bare `php` here would re-enter this wrapper forever.
			writeExecutable(
				path.join( binDir, 'php' ),
				`#!/bin/bash
exec ${ REAL_PHP } "$@"
`
			);
			writeExecutable(
				path.join( binDir, 'mysql' ),
				`#!/bin/bash
echo "$@" >> "${ root }/mysql-calls.log"
for arg in "$@"; do
  case "$arg" in
    -e) exit 0 ;;
    --defaults-file=*) cp "\${arg#--defaults-file=}" "${ root }/my.cnf" ;;
  esac
done
cat > "${ root }/imported.sql"
echo "$@" > "${ root }/mysql-args.txt"
`
			);

			const result = await deploySite( deployOptions( { includeDatabase: true } ) );

			expect( result.databasePushed ).toBe( true );
			expect( fs.readFileSync( path.join( root, 'imported.sql' ), 'utf8' ) ).toContain(
				'https://example.com'
			);

			// Credentials belong in the config file, never in the argument list
			// where any user on the server could read them.
			const mysqlArgs = fs.readFileSync( path.join( root, 'mysql-args.txt' ), 'utf8' );
			expect( mysqlArgs ).toContain( 'livedb' );
			expect( mysqlArgs ).not.toContain( 'liveuser' );
			expect( mysqlArgs ).not.toContain( 'ass' );

			// The imported rewrite rules are dropped so WordPress rebuilds them with plugins loaded.
			const mysqlCalls = fs.readFileSync( path.join( root, 'mysql-calls.log' ), 'utf8' );
			expect( mysqlCalls ).toContain(
				"DELETE FROM `wp_options` WHERE option_name = 'rewrite_rules'"
			);

			// wp-config.php is read by PHP, so a password with a quote and a
			// backslash survives intact, and the host's port suffix is split out.
			const cnf = fs.readFileSync( path.join( root, 'my.cnf' ), 'utf8' );
			expect( cnf ).toContain( 'user=liveuser' );
			expect( cnf ).toContain( "password=p'ass\\word" );
			expect( cnf ).toContain( 'host=127.0.0.1' );
			expect( cnf ).toContain( 'port=3307' );
		}
	);

	it( 'refuses to push a database when the server can do neither', async () => {
		installFakeWp( 'absent' );
		fs.rmSync( path.join( remotePath, 'wp-config.php' ) );

		await expect( deploySite( deployOptions( { includeDatabase: true } ) ) ).rejects.toThrow(
			/database cannot be imported/i
		);
	} );

	it( 'fails when the remote path does not exist, rather than creating it', async () => {
		const missing = path.join( root, 'not-there' );

		await expect(
			deploySite( deployOptions( { target: makeTarget( { remotePath: missing } ) } ) )
		).rejects.toThrow( /does not exist/i );
		expect( fs.existsSync( missing ) ).toBe( false );
	} );

	it( 'fails before touching the server when the remote path is not writable', async () => {
		fs.chmodSync( remotePath, 0o500 );

		try {
			await expect( deploySite( deployOptions() ) ).rejects.toThrow( /cannot write/i );
		} finally {
			fs.chmodSync( remotePath, 0o700 );
		}
	} );

	it( 'removes server files that no longer exist locally', async () => {
		const stalePath = path.join( remotePath, 'wp-content', 'themes', 'oldtheme' );
		fs.mkdirSync( stalePath, { recursive: true } );
		fs.writeFileSync( path.join( stalePath, 'style.css' ), 'old' );

		await deploySite( deployOptions( { target: makeTarget( { deleteRemoved: true } ) } ) );

		expect( fs.existsSync( stalePath ) ).toBe( false );
	} );

	it( 'keeps server files when deleting is turned off', async () => {
		const stalePath = path.join( remotePath, 'wp-content', 'themes', 'oldtheme' );
		fs.mkdirSync( stalePath, { recursive: true } );
		fs.writeFileSync( path.join( stalePath, 'style.css' ), 'old' );

		await deploySite( deployOptions( { target: makeTarget( { deleteRemoved: false } ) } ) );

		expect( fs.existsSync( stalePath ) ).toBe( true );
	} );

	it( 'rewrites a stale address that only the database still holds', async () => {
		exportDatabaseToFile.mockImplementation( async ( _site: unknown, destination: string ) => {
			fs.writeFileSync(
				destination,
				"INSERT INTO `wp_options` VALUES (1,'siteurl','http://localhost:9999','yes');",
				'utf8'
			);
		} );

		await deploySite( deployOptions( { includeDatabase: true } ) );

		const imported = fs.readFileSync( path.join( root, 'imported.sql' ), 'utf8' );
		expect( imported ).toContain( 'https://example.com' );
		expect( imported ).not.toContain( 'localhost:9999' );
	} );
} );

describe( 'the environment the tests assume', () => {
	it( 'has a real rsync to delegate to', () => {
		const result = spawnSync( '/usr/bin/rsync', [ '--version' ], { encoding: 'utf8' } );
		expect( result.status ).toBe( 0 );
	} );
} );

describe( 'getRemoteBackupDir', () => {
	const environment = ( homeDir: string ) => ( { tmpDir: '/tmp', homeDir } ) as RemoteEnvironment;

	it( 'keeps backups under the SSH user home, one directory per site', () => {
		expect(
			getRemoteBackupDir( environment( '/home/runcloud' ), '/home/runcloud/webapps/aoi' )
		).toBe( '/home/runcloud/.studio-deploy/home-runcloud-webapps-aoi' );
	} );

	it( 'falls back to the temp directory when the home is the web root or inside it', () => {
		expect( getRemoteBackupDir( environment( '/var/www/html' ), '/var/www/html' ) ).toBe(
			'/tmp/.studio-deploy/var-www-html'
		);
		expect( getRemoteBackupDir( environment( '/var/www/html/user' ), '/var/www/html/' ) ).toBe(
			'/tmp/.studio-deploy/var-www-html'
		);
	} );

	it( 'falls back to the temp directory when the server reports no home', () => {
		expect( getRemoteBackupDir( environment( '' ), '/srv/site' ) ).toBe(
			'/tmp/.studio-deploy/srv-site'
		);
	} );
} );
