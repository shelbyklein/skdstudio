/**
 * Pushes a local site to a server over SSH.
 *
 * The order matters. Files go first so that a failure there leaves the live
 * database untouched, and the database is rewritten to the destination URL
 * before it is uploaded, so the server never holds a dump that points at
 * localhost.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeDeployTarget, type DeployTarget } from '@studio/common/lib/deploy-target';
import {
	findSiteUrlsInDump,
	rewriteSqlUrls,
	withBothSchemes,
} from '@studio/common/lib/sql-url-rewrite';
import { DeployCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { buildExcludeFile } from 'cli/lib/deploy/excludes';
import {
	buildDatabaseImportScript,
	buildEnsurePathScript,
	buildPreflightScript,
	parseImported,
	parsePreflight,
	type RemoteEnvironment,
} from 'cli/lib/deploy/remote-scripts';
import { runRemoteScript, runRsync, uploadFile } from 'cli/lib/deploy/ssh';
import { exportDatabaseToFile } from 'cli/lib/import-export/export/export-database';
import { getFullyResolvedTmpDirPath } from 'cli/lib/native-php/tmp-dir';
import { Logger, LoggerError } from 'cli/logger';
import type { SiteData } from 'cli/lib/cli-config/core';

export interface DeployOptions {
	site: SiteData;
	target: DeployTarget;
	/** Push the database along with the files. */
	includeDatabase: boolean;
	/** Keep a copy of the live database on the server before overwriting it. */
	backupRemoteDatabase: boolean;
	/** Report what would change without writing anything to the server. */
	dryRun: boolean;
	signal?: AbortSignal;
	logger: Logger< LoggerAction >;
}

export interface DeployResult {
	filesTransferred: number;
	changedPaths: string[];
	databasePushed: boolean;
	urlReplacements: number;
	remoteBackupPath?: string;
	dryRun: boolean;
}

/**
 * Where the safety copy of the live database is kept, under the SSH user's
 * home directory. Never inside the WordPress root: anything there is served by
 * the web server, and a full database dump would be downloadable by anyone
 * who guessed its URL.
 */
const REMOTE_BACKUP_DIRNAME = '.studio-deploy';

function isSameOrInside( child: string, parent: string ): boolean {
	const relative = path.posix.relative( parent, child );
	return (
		relative === '' || ( ! relative.startsWith( '..' ) && ! path.posix.isAbsolute( relative ) )
	);
}

/**
 * One directory per site, named after its remote path, so backups from several
 * sites on the same server never mix. Falls back to the server's temp directory
 * when the home directory is unknown or is itself inside the web root.
 */
export function getRemoteBackupDir( environment: RemoteEnvironment, remotePath: string ): string {
	const home = environment.homeDir.replace( /\/+$/, '' );
	const root = home && ! isSameOrInside( home, remotePath ) ? home : environment.tmpDir;
	const siteDir =
		remotePath.replace( /^\/+|\/+$/g, '' ).replace( /[^A-Za-z0-9._-]+/g, '-' ) || 'site';
	return `${ root }/${ REMOTE_BACKUP_DIRNAME }/${ siteDir }`;
}

function timestamp(): string {
	return new Date().toISOString().replace( /[:.]/g, '-' );
}

function assertRemoteUsable( environment: RemoteEnvironment, target: DeployTarget ): void {
	if ( ! environment.pathExists ) {
		throw new LoggerError(
			sprintf( __( 'The directory %s does not exist on the server.' ), target.remotePath ),
			undefined,
			'remote_path_missing'
		);
	}
	if ( ! environment.pathWritable ) {
		throw new LoggerError(
			sprintf( __( 'The SSH user cannot write to %s on the server.' ), target.remotePath ),
			undefined,
			'remote_path_readonly'
		);
	}
	if ( ! environment.hasRsync ) {
		throw new LoggerError(
			__( 'rsync is not installed on the server. Install it and deploy again.' ),
			undefined,
			'remote_rsync_missing'
		);
	}
}

function assertDatabaseSupported( environment: RemoteEnvironment ): void {
	if ( environment.wpCli === 'working' ) {
		return;
	}
	if ( ! environment.hasWpConfig ) {
		throw new LoggerError(
			__(
				'The server has no WP-CLI and no wp-config.php in the deploy directory, so the database cannot be imported. Install WP-CLI, or deploy files only.'
			),
			undefined,
			'remote_database_unsupported'
		);
	}
	if ( ! environment.hasPhp || ! environment.hasMysql ) {
		throw new LoggerError(
			__(
				'The server needs either WP-CLI, or PHP and the mysql client, to import the database. Install one of them, or deploy files only.'
			),
			undefined,
			'remote_database_unsupported'
		);
	}
}

/**
 * Produces the dump that will be imported on the server: exported from the
 * local SQLite database, then rewritten from every URL the site is known by
 * to the destination URL.
 */
async function prepareDatabaseDump(
	options: DeployOptions,
	workDir: string
): Promise< { dumpPath: string; replacements: number } > {
	const { site, target, logger } = options;

	logger.reportStart( LoggerAction.EXPORT_DATABASE, __( 'Exporting the local database…' ) );
	const rawDump = path.join( workDir, 'database.sql' );
	await exportDatabaseToFile( site, rawDump );
	logger.reportSuccess( __( 'Local database exported' ) );

	logger.reportStart( LoggerAction.REWRITE_URLS, __( 'Rewriting site URLs…' ) );
	const sql = await fs.readFile( rawDump, 'utf8' );

	// The site's current address is the usual source URL, but a site that has
	// changed port or gained a custom domain still holds the older one in its
	// content, so anything recorded as siteurl/home is rewritten as well.
	const sourceUrls = new Set< string >(
		[ getSiteUrl( site ), ...findSiteUrlsInDump( sql ) ].flatMap( withBothSchemes )
	);
	for ( const remoteVariant of withBothSchemes( target.remoteUrl ) ) {
		sourceUrls.delete( remoteVariant );
	}

	let rewritten = sql;
	let replacements = 0;
	for ( const sourceUrl of sourceUrls ) {
		const result = rewriteSqlUrls( rewritten, sourceUrl, target.remoteUrl );
		rewritten = result.sql;
		replacements += result.replacements;
	}

	const dumpPath = path.join( workDir, 'database-deploy.sql' );
	await fs.writeFile( dumpPath, rewritten, 'utf8' );
	logger.reportSuccess(
		sprintf( _n( 'Rewrote %d site URL', 'Rewrote %d site URLs', replacements ), replacements )
	);

	return { dumpPath, replacements };
}

export async function deploySite( options: DeployOptions ): Promise< DeployResult > {
	const { site, target, logger, signal } = options;

	const workDir = await fs.mkdtemp( path.join( getFullyResolvedTmpDirPath(), 'studio-deploy-' ) );

	try {
		logger.reportStart(
			LoggerAction.CONNECT,
			sprintf( __( 'Connecting to %s…' ), describeDeployTarget( target ) )
		);

		const preflight = await runRemoteScript( target, buildPreflightScript( target.remotePath ), {
			signal,
		} );
		const environment = parsePreflight( preflight.stdout );
		logger.reportSuccess( __( 'Connected to the server' ) );

		logger.reportStart( LoggerAction.PREFLIGHT, __( 'Checking the server…' ) );
		assertRemoteUsable( environment, target );
		if ( options.includeDatabase ) {
			assertDatabaseSupported( environment );
		}
		if ( ! environment.hasWpConfig && ! environment.hasWpContent ) {
			logger.reportWarning(
				sprintf(
					__( '%s does not look like a WordPress installation yet. Deploying into it anyway.' ),
					target.remotePath
				)
			);
		}
		if ( ! options.includeDatabase ) {
			logger.reportSuccess( __( 'Server ready' ) );
		} else {
			logger.reportSuccess(
				environment.wpCli === 'working'
					? __( 'Server ready, using WP-CLI for the database' )
					: __( 'Server ready, using the mysql client for the database' )
			);
		}

		// The dump is prepared before the file sync so that a failure to export
		// or rewrite it costs nothing on the server.
		let dump: { dumpPath: string; replacements: number } | undefined;
		if ( options.includeDatabase ) {
			dump = await prepareDatabaseDump( options, workDir );
		}

		logger.reportStart(
			LoggerAction.SYNC_FILES,
			options.dryRun ? __( 'Checking which files would change…' ) : __( 'Copying files…' )
		);
		const excludeFile = await buildExcludeFile( site.path, workDir );
		const sync = await runRsync( target, {
			localPath: site.path,
			remotePath: target.remotePath,
			excludeFile,
			deleteRemoved: target.deleteRemoved !== false,
			dryRun: options.dryRun,
			signal,
			onFileTransferred: ( count ) => {
				logger.reportProgress( sprintf( __( 'Copying files… (%d)' ), count ) );
			},
		} );
		logger.reportSuccess(
			options.dryRun
				? sprintf(
						_n( '%d file would change', '%d files would change', sync.filesTransferred ),
						sync.filesTransferred
				  )
				: sprintf(
						_n( '%d file copied', '%d files copied', sync.filesTransferred ),
						sync.filesTransferred
				  )
		);

		let remoteBackupPath: string | undefined;
		let databasePushed = false;

		if ( dump && ! options.dryRun ) {
			const remoteDumpPath = `${ environment.tmpDir }/studio-deploy-${ timestamp() }.sql`;

			logger.reportStart( LoggerAction.UPLOAD_DATABASE, __( 'Uploading the database…' ) );
			await uploadFile( target, dump.dumpPath, remoteDumpPath, { signal } );
			logger.reportSuccess( __( 'Database uploaded' ) );

			if ( options.backupRemoteDatabase ) {
				const backupDir = getRemoteBackupDir( environment, target.remotePath );
				remoteBackupPath = `${ backupDir }/before-${ timestamp() }.sql`;
				await runRemoteScript( target, buildEnsurePathScript( backupDir, { ownerOnly: true } ), {
					signal,
				} );
			}

			logger.reportStart( LoggerAction.IMPORT_DATABASE, __( 'Importing the database…' ) );
			const importResult = await runRemoteScript(
				target,
				buildDatabaseImportScript( {
					remotePath: target.remotePath,
					dumpPath: remoteDumpPath,
					backupPath: remoteBackupPath,
					useWpCli: environment.wpCli === 'working',
					wpCliAllowRoot: environment.wpCliAllowRoot,
				} ),
				{
					signal,
					onStdoutLine: ( line ) => {
						const message = line.trim();
						if ( message && ! message.startsWith( '---' ) && ! message.includes( '=' ) ) {
							logger.reportProgress( message );
						}
					},
				}
			);

			if ( importResult.code !== 0 || ! parseImported( importResult.stdout ) ) {
				const detail = importResult.stderr.trim().split( '\n' ).slice( -3 ).join( ' ' );
				throw new LoggerError(
					detail
						? sprintf( __( 'Importing the database on the server failed: %s' ), detail )
						: __( 'Importing the database on the server failed.' ),
					undefined,
					'remote_database_import'
				);
			}

			databasePushed = true;
			logger.reportSuccess( __( 'Database imported' ) );
		}

		return {
			filesTransferred: sync.filesTransferred,
			changedPaths: sync.paths,
			databasePushed,
			urlReplacements: dump?.replacements ?? 0,
			remoteBackupPath,
			dryRun: options.dryRun,
		};
	} finally {
		await fs.rm( workDir, { recursive: true, force: true } ).catch( () => undefined );
	}
}
