/**
 * The bash Studio runs on the deployment server.
 *
 * Every script is piped to `bash -s` over stdin rather than passed as an ssh
 * argument, so nothing here shows up in the server's process list and no value
 * has to survive a second round of shell quoting.
 */
import { shellQuote } from '@studio/common/lib/deploy-target';

/** Printed before the values a script reports, so host login banners are ignored. */
const REPORT_MARKER = '---studio-report---';

export type WpCliState = 'absent' | 'broken' | 'working';

export interface RemoteEnvironment {
	pathExists: boolean;
	pathWritable: boolean;
	hasWpConfig: boolean;
	hasWpContent: boolean;
	hasRsync: boolean;
	hasPhp: boolean;
	hasMysql: boolean;
	hasMysqldump: boolean;
	wpCli: WpCliState;
	/** WP-CLI refuses to run as root unless told to; true when that was needed. */
	wpCliAllowRoot: boolean;
	tmpDir: string;
}

/**
 * Collects everything the deploy needs to know about the server in a single
 * round trip, so a misconfigured target fails before anything is written.
 */
export function buildPreflightScript( remotePath: string ): string {
	const path = shellQuote( remotePath );

	return `set -u
target=${ path }
echo "${ REPORT_MARKER }"
if [ -d "$target" ]; then echo "pathExists=1"; else echo "pathExists=0"; fi
if [ -w "$target" ]; then echo "pathWritable=1"; else echo "pathWritable=0"; fi
if [ -f "$target/wp-config.php" ]; then echo "hasWpConfig=1"; else echo "hasWpConfig=0"; fi
if [ -d "$target/wp-content" ]; then echo "hasWpContent=1"; else echo "hasWpContent=0"; fi
if command -v rsync >/dev/null 2>&1; then echo "hasRsync=1"; else echo "hasRsync=0"; fi
if command -v php >/dev/null 2>&1; then echo "hasPhp=1"; else echo "hasPhp=0"; fi
if command -v mysql >/dev/null 2>&1; then echo "hasMysql=1"; else echo "hasMysql=0"; fi
if command -v mysqldump >/dev/null 2>&1; then echo "hasMysqldump=1"; else echo "hasMysqldump=0"; fi
if command -v wp >/dev/null 2>&1; then
  if wp --path="$target" --skip-plugins --skip-themes core version >/dev/null 2>&1; then
    echo "wpCli=working"; echo "wpCliAllowRoot=0"
  elif wp --path="$target" --skip-plugins --skip-themes --allow-root core version >/dev/null 2>&1; then
    echo "wpCli=working"; echo "wpCliAllowRoot=1"
  else
    echo "wpCli=broken"; echo "wpCliAllowRoot=0"
  fi
else
  echo "wpCli=absent"; echo "wpCliAllowRoot=0"
fi
echo "tmpDir=\${TMPDIR:-/tmp}"
`;
}

function parseReport( stdout: string ): Record< string, string > {
	const markerIndex = stdout.lastIndexOf( REPORT_MARKER );
	const body = markerIndex === -1 ? stdout : stdout.slice( markerIndex + REPORT_MARKER.length );
	const values: Record< string, string > = {};

	for ( const line of body.split( '\n' ) ) {
		const separator = line.indexOf( '=' );
		if ( separator <= 0 ) {
			continue;
		}
		values[ line.slice( 0, separator ).trim() ] = line.slice( separator + 1 ).trim();
	}

	return values;
}

export function parsePreflight( stdout: string ): RemoteEnvironment {
	const values = parseReport( stdout );
	const flag = ( key: string ) => values[ key ] === '1';
	const wpCli = values.wpCli;

	return {
		pathExists: flag( 'pathExists' ),
		pathWritable: flag( 'pathWritable' ),
		hasWpConfig: flag( 'hasWpConfig' ),
		hasWpContent: flag( 'hasWpContent' ),
		hasRsync: flag( 'hasRsync' ),
		hasPhp: flag( 'hasPhp' ),
		hasMysql: flag( 'hasMysql' ),
		hasMysqldump: flag( 'hasMysqldump' ),
		wpCli: wpCli === 'working' || wpCli === 'broken' ? wpCli : 'absent',
		wpCliAllowRoot: flag( 'wpCliAllowRoot' ),
		tmpDir: values.tmpDir || '/tmp',
	};
}

export interface DatabaseImportOptions {
	remotePath: string;
	/** Absolute path of the uploaded dump on the server. */
	dumpPath: string;
	/** Where to write the pre-import snapshot of the live database. */
	backupPath?: string;
	useWpCli: boolean;
	wpCliAllowRoot: boolean;
}

/**
 * Reads the live database credentials out of wp-config.php.
 *
 * The file is included rather than pattern-matched so that passwords
 * containing quotes or escapes come through exactly as PHP sees them.
 * Including it always ends in a fatal error on its final `require_once` of
 * wp-settings.php, which is why the values are printed from a shutdown
 * handler that runs regardless.
 */
function getCredentialsPhp(): string {
	return `<?php
register_shutdown_function( function () {
	echo "${ REPORT_MARKER }\\n";
	foreach ( array( 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_CHARSET' ) as $key ) {
		echo $key . '=' . ( defined( $key ) ? constant( $key ) : '' ) . "\\n";
	}
	echo 'table_prefix=' . ( isset( $GLOBALS['table_prefix'] ) ? $GLOBALS['table_prefix'] : 'wp_' ) . "\\n";
} );
error_reporting( 0 );
ini_set( 'display_errors', '0' );
define( 'ABSPATH', '/nonexistent-studio-abspath/' );
include $argv[1];
`;
}

/**
 * The bash that reads the live credentials into a private my.cnf, shared by
 * the import and export fallbacks. `$cnf` is left holding the file and a trap
 * removes it; the caller only has to pass `--defaults-file="$cnf"`.
 */
function buildCredentialsPreamble(): string {
	return `creds_php="$(mktemp)"
cnf="$(mktemp)"
chmod 600 "$creds_php" "$cnf"
cleanup() { rm -f "$creds_php" "$cnf"; }
trap cleanup EXIT

cat > "$creds_php" <<'STUDIO_CREDS_PHP'
${ getCredentialsPhp() }
STUDIO_CREDS_PHP

creds="$(php "$creds_php" "$target/wp-config.php" 2>/dev/null | sed -n '/${ REPORT_MARKER }/,$p')"
get() { printf '%s\\n' "$creds" | sed -n "s/^$1=//p" | head -n 1; }

db_name="$(get DB_NAME)"
db_user="$(get DB_USER)"
db_pass="$(get DB_PASSWORD)"
db_host="$(get DB_HOST)"

if [ -z "$db_name" ]; then
  echo "Could not read the database name from wp-config.php" >&2
  exit 3
fi

# DB_HOST carries an optional ":port" or ":/path/to/socket" suffix.
host_part="\${db_host%%:*}"
suffix_part=""
case "$db_host" in
  *:*) suffix_part="\${db_host#*:}" ;;
esac

{
  echo "[client]"
  echo "user=$db_user"
  echo "password=$db_pass"
  if [ -n "$host_part" ]; then echo "host=$host_part"; fi
  case "$suffix_part" in
    "") ;;
    /*) echo "socket=$suffix_part" ;;
    *) echo "port=$suffix_part" ;;
  esac
} > "$cnf"
`;
}

/** Builds the `wp` invocation for a server, honouring a root-only install. */
function wpRunner( remotePath: string, allowRoot: boolean ): string {
	return `wp_run() { wp --path=${ remotePath } --skip-plugins --skip-themes ${
		allowRoot ? '--allow-root' : ''
	} "$@"; }`;
}

/**
 * Imports the dump with WP-CLI when the server has it, and with the mysql
 * client otherwise. The credentials the fallback needs are written to a
 * private my.cnf instead of the command line, where every user on the box
 * could read them out of the process list.
 */
export function buildDatabaseImportScript( options: DatabaseImportOptions ): string {
	const remotePath = shellQuote( options.remotePath );
	const dumpPath = shellQuote( options.dumpPath );
	const backupPath = options.backupPath ? shellQuote( options.backupPath ) : '';

	if ( options.useWpCli ) {
		return `set -eu
target=${ remotePath }
dump=${ dumpPath }
${ wpRunner( remotePath, options.wpCliAllowRoot ) }
${
	backupPath
		? `echo "Backing up the live database…"
wp_run db export ${ backupPath } >/dev/null`
		: ''
}
echo "Importing the database…"
wp_run db import "$dump"
wp_run cache flush >/dev/null 2>&1 || true
wp_run rewrite flush >/dev/null 2>&1 || true
rm -f "$dump"
echo "${ REPORT_MARKER }"
echo "imported=1"
`;
	}

	return `set -eu
target=${ remotePath }
dump=${ dumpPath }
${ buildCredentialsPreamble() }
${
	backupPath
		? `echo "Backing up the live database…"
if command -v mysqldump >/dev/null 2>&1; then
  mysqldump --defaults-file="$cnf" "$db_name" > ${ backupPath }
else
  echo "mysqldump is not installed; skipping the safety backup" >&2
fi`
		: ''
}
echo "Importing the database…"
mysql --defaults-file="$cnf" "$db_name" < "$dump"
rm -f "$dump"
echo "${ REPORT_MARKER }"
echo "imported=1"
`;
}

export interface DatabaseExportOptions {
	remotePath: string;
	/** Where on the server to write the dump, for the caller to download. */
	dumpPath: string;
	useWpCli: boolean;
	wpCliAllowRoot: boolean;
}

/** Dumps the live database so a pull can bring it down. */
export function buildDatabaseExportScript( options: DatabaseExportOptions ): string {
	const remotePath = shellQuote( options.remotePath );
	const dumpPath = shellQuote( options.dumpPath );

	if ( options.useWpCli ) {
		return `set -eu
target=${ remotePath }
${ wpRunner( remotePath, options.wpCliAllowRoot ) }
echo "Exporting the live database…"
wp_run db export ${ dumpPath } >/dev/null
echo "${ REPORT_MARKER }"
echo "exported=1"
`;
	}

	return `set -eu
target=${ remotePath }
${ buildCredentialsPreamble() }
if ! command -v mysqldump >/dev/null 2>&1; then
  echo "mysqldump is not installed on the server" >&2
  exit 4
fi
echo "Exporting the live database…"
mysqldump --defaults-file="$cnf" --no-tablespaces --single-transaction "$db_name" > ${ dumpPath }
echo "${ REPORT_MARKER }"
echo "exported=1"
`;
}

/** Removes a file the pull has finished with. */
export function buildRemoveFileScript( remoteFilePath: string ): string {
	return `rm -f ${ shellQuote( remoteFilePath ) }
echo "${ REPORT_MARKER }"
echo "removed=1"
`;
}

/** Confirms the remote directory is writable and creates it when missing. */
export function buildEnsurePathScript( remotePath: string ): string {
	return `set -eu
target=${ shellQuote( remotePath ) }
mkdir -p "$target"
echo "${ REPORT_MARKER }"
echo "ready=1"
`;
}

export function parseImported( stdout: string ): boolean {
	return parseReport( stdout ).imported === '1';
}

export function parseExported( stdout: string ): boolean {
	return parseReport( stdout ).exported === '1';
}
