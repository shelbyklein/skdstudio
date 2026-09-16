/**
 * Brings a live site down onto this machine: the inverse of a deploy.
 *
 * The order is the mirror image of pushing. The database is dumped and
 * downloaded before any local file is touched, so a server that cannot produce
 * a dump costs nothing locally, and the local database is only replaced once
 * everything else has arrived.
 *
 * The same exclusions apply in both directions, and they matter more here: the
 * live site has a MySQL `wp-config.php` and no SQLite drop-in, so copying those
 * down would leave the local site unable to open its own database.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { describeDeployTarget, type DeployTarget } from '@studio/common/lib/deploy-target';
import { findSiteUrlsInDump, rewriteSqlUrls } from '@studio/common/lib/sql-url-rewrite';
import { DeployCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { buildExcludeFile } from 'cli/lib/deploy/excludes';
import {
	buildDatabaseExportScript,
	buildPreflightScript,
	buildRemoveFileScript,
	parseExported,
	parsePreflight,
	type RemoteEnvironment,
} from 'cli/lib/deploy/remote-scripts';
import { downloadFile, runRemoteScript, runRsync } from 'cli/lib/deploy/ssh';
import { getFullyResolvedTmpDirPath } from 'cli/lib/native-php/tmp-dir';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { Logger, LoggerError } from 'cli/logger';
import type { SiteData } from 'cli/lib/cli-config/core';

export interface PullOptions {
	site: SiteData;
	target: DeployTarget;
	/** Bring the live database down as well as the files. */
	includeDatabase: boolean;
	/** Remove local files that no longer exist on the server. */
	deleteRemoved: boolean;
	/** Report what would change without writing anything locally. */
	dryRun: boolean;
	signal?: AbortSignal;
	logger: Logger< LoggerAction >;
}

export interface PullResult {
	filesTransferred: number;
	changedPaths: string[];
	databasePulled: boolean;
	urlReplacements: number;
	/** The administrator the local auto-login was pointed at, when it changed. */
	adminUsername?: string;
	dryRun: boolean;
}

function timestamp(): string {
	return new Date().toISOString().replace( /[:.]/g, '-' );
}

function assertRemoteReadable( environment: RemoteEnvironment, target: DeployTarget ): void {
	if ( ! environment.pathExists ) {
		throw new LoggerError(
			sprintf( __( 'The directory %s does not exist on the server.' ), target.remotePath ),
			undefined,
			'remote_path_missing'
		);
	}
	if ( ! environment.hasRsync ) {
		throw new LoggerError(
			__( 'rsync is not installed on the server. Install it and pull again.' ),
			undefined,
			'remote_rsync_missing'
		);
	}
	if ( ! environment.hasWpConfig && ! environment.hasWpContent ) {
		throw new LoggerError(
			sprintf(
				__( '%s does not look like a WordPress installation, so there is nothing to pull.' ),
				target.remotePath
			),
			undefined,
			'remote_not_wordpress'
		);
	}
}

function assertDatabaseExportable( environment: RemoteEnvironment ): void {
	if ( environment.wpCli === 'working' ) {
		return;
	}
	if ( ! environment.hasWpConfig || ! environment.hasPhp || ! environment.hasMysqldump ) {
		throw new LoggerError(
			__(
				'The server needs either WP-CLI, or PHP and mysqldump, to hand over its database. Install one of them, or pull the files only.'
			),
			undefined,
			'remote_database_unsupported'
		);
	}
}

/**
 * Points the auto-login mu-plugin at an administrator that exists in the
 * database that just arrived.
 *
 * Without this, one-click WP Admin breaks on every pulled site: the endpoint
 * reads the `studio_admin_username` option, the live database has never heard
 * of it, and the fallback guess of "admin" is rarely a real account.
 */
async function realignAdminUser( site: SiteData ): Promise< string | undefined > {
	const listAdmins = await runWpCliCommand(
		site,
		[
			'user',
			'list',
			'--role=administrator',
			'--field=user_login',
			'--number=1',
			'--skip-plugins',
			'--skip-themes',
		],
		{ phpVersion: DEFAULT_PHP_VERSION }
	);

	const output = ( await listAdmins.response.stdoutText ).trim();
	await listAdmins.response.exitCode;
	const adminUsername = output
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( Boolean )[ 0 ];

	if ( ! adminUsername ) {
		return undefined;
	}

	const setOption = await runWpCliCommand(
		site,
		[
			'option',
			'update',
			'studio_admin_username',
			adminUsername,
			'--skip-plugins',
			'--skip-themes',
		],
		{ phpVersion: DEFAULT_PHP_VERSION }
	);
	await setOption.response.exitCode;

	return adminUsername;
}

/** Replaces the local SQLite database with the dump that came down. */
async function importDumpIntoSite( site: SiteData, dumpPath: string ): Promise< void > {
	// `wp sqlite import` resolves its argument relative to the site directory,
	// so the dump is staged there and removed afterwards.
	const stagedName = `studio-pull-${ timestamp() }.sql`;
	const stagedPath = path.join( site.path, stagedName );
	await fs.copyFile( dumpPath, stagedPath );

	try {
		const command = await runWpCliCommand(
			site,
			[ 'sqlite', 'import', stagedName, '--enable-ast-driver', '--skip-plugins', '--skip-themes' ],
			{ requireSqliteCliCommand: true, phpVersion: DEFAULT_PHP_VERSION }
		);

		const exitCode = await command.response.exitCode;
		if ( exitCode !== 0 ) {
			const stderr = ( await command.response.stderrText ).trim();
			throw new LoggerError(
				stderr
					? sprintf( __( 'Importing the live database failed: %s' ), stderr )
					: __( 'Importing the live database failed.' ),
				undefined,
				'database_import'
			);
		}
	} finally {
		await fs.rm( stagedPath, { force: true } ).catch( () => undefined );
	}
}

export async function pullSite( options: PullOptions ): Promise< PullResult > {
	const { site, target, logger, signal } = options;

	const workDir = await fs.mkdtemp( path.join( getFullyResolvedTmpDirPath(), 'studio-pull-' ) );

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
		assertRemoteReadable( environment, target );
		if ( options.includeDatabase ) {
			assertDatabaseExportable( environment );
		}
		logger.reportSuccess( __( 'Server ready' ) );

		// The database comes down first: a server that cannot produce a dump
		// should cost nothing locally.
		let localDumpPath: string | undefined;
		if ( options.includeDatabase && ! options.dryRun ) {
			const remoteDumpPath = `${ environment.tmpDir }/studio-pull-${ timestamp() }.sql`;

			logger.reportStart( LoggerAction.EXPORT_DATABASE, __( 'Exporting the live database…' ) );
			const exportResult = await runRemoteScript(
				target,
				buildDatabaseExportScript( {
					remotePath: target.remotePath,
					dumpPath: remoteDumpPath,
					useWpCli: environment.wpCli === 'working',
					wpCliAllowRoot: environment.wpCliAllowRoot,
				} ),
				{ signal }
			);

			if ( exportResult.code !== 0 || ! parseExported( exportResult.stdout ) ) {
				const detail = exportResult.stderr.trim().split( '\n' ).slice( -3 ).join( ' ' );
				throw new LoggerError(
					detail
						? sprintf( __( 'Exporting the live database failed: %s' ), detail )
						: __( 'Exporting the live database failed.' ),
					undefined,
					'remote_database_export'
				);
			}
			logger.reportSuccess( __( 'Live database exported' ) );

			logger.reportStart( LoggerAction.UPLOAD_DATABASE, __( 'Downloading the database…' ) );
			localDumpPath = path.join( workDir, 'remote.sql' );
			await downloadFile( target, remoteDumpPath, localDumpPath, { signal } );
			await runRemoteScript( target, buildRemoveFileScript( remoteDumpPath ), { signal } ).catch(
				() => undefined
			);
			logger.reportSuccess( __( 'Database downloaded' ) );
		}

		logger.reportStart(
			LoggerAction.SYNC_FILES,
			options.dryRun ? __( 'Checking which files would change…' ) : __( 'Downloading files…' )
		);
		const excludeFile = await buildExcludeFile( site.path, workDir );
		const sync = await runRsync( target, {
			localPath: site.path,
			remotePath: target.remotePath,
			direction: 'download',
			excludeFile,
			deleteRemoved: options.deleteRemoved,
			dryRun: options.dryRun,
			signal,
			onFileTransferred: ( count ) => {
				logger.reportProgress( sprintf( __( 'Downloading files… (%d)' ), count ) );
			},
		} );
		logger.reportSuccess(
			options.dryRun
				? sprintf( __( '%d file(s) would change' ), sync.filesTransferred )
				: sprintf( __( '%d file(s) downloaded' ), sync.filesTransferred )
		);

		let urlReplacements = 0;
		let adminUsername: string | undefined;

		if ( localDumpPath ) {
			logger.reportStart( LoggerAction.REWRITE_URLS, __( 'Rewriting site URLs…' ) );
			const sql = await fs.readFile( localDumpPath, 'utf8' );
			const localUrl = getSiteUrl( site );

			// Anything the dump calls itself becomes the local address, so a
			// server reachable under more than one hostname still lands here.
			const sourceUrls = new Set< string >( [ target.remoteUrl, ...findSiteUrlsInDump( sql ) ] );
			sourceUrls.delete( localUrl );

			let rewritten = sql;
			for ( const sourceUrl of sourceUrls ) {
				const result = rewriteSqlUrls( rewritten, sourceUrl, localUrl );
				rewritten = result.sql;
				urlReplacements += result.replacements;
			}

			const preparedPath = path.join( workDir, 'local.sql' );
			await fs.writeFile( preparedPath, rewritten, 'utf8' );
			logger.reportSuccess( sprintf( __( 'Rewrote %d site URL(s)' ), urlReplacements ) );

			logger.reportStart( LoggerAction.IMPORT_DATABASE, __( 'Importing into the local site…' ) );
			await importDumpIntoSite( site, preparedPath );
			adminUsername = await realignAdminUser( site );
			logger.reportSuccess( __( 'Local database replaced' ) );
		}

		return {
			filesTransferred: sync.filesTransferred,
			changedPaths: sync.paths,
			databasePulled: Boolean( localDumpPath ),
			urlReplacements,
			adminUsername,
			dryRun: options.dryRun,
		};
	} finally {
		await fs.rm( workDir, { recursive: true, force: true } ).catch( () => undefined );
	}
}
