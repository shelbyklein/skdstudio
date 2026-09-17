import { createInterface } from 'node:readline/promises';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { describeDeployTarget, type DeployTarget } from '@studio/common/lib/deploy-target';
import { DeployCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { clearSiteLatestCliPid, getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { pullSite, type PullResult } from 'cli/lib/deploy/pull-manager';
import { resolveDeployTarget } from 'cli/lib/deploy/target-store';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

/**
 * Asks before replacing local work. Only reachable from a terminal: the
 * desktop app has its own confirmation and leaves no stdin to read.
 */
async function confirmPull( target: DeployTarget, siteName: string ): Promise< boolean > {
	const readline = createInterface( { input: process.stdin, output: process.stdout } );
	try {
		console.log(
			sprintf( __( 'About to pull %1$s into %2$s.' ), describeDeployTarget( target ), siteName )
		);
		console.log(
			__(
				'This replaces the local files and database with the live site. Local changes you have not deployed will be lost.'
			)
		);
		const answer = await readline.question( __( 'Continue? [y/N] ' ) );
		return /^y(es)?$/i.test( answer.trim() );
	} finally {
		readline.close();
	}
}

function reportResult( result: PullResult, siteUrl: string ): void {
	if ( result.dryRun ) {
		console.log(
			sprintf(
				__( 'Dry run: %d file(s) would change. Nothing was changed locally.' ),
				result.filesTransferred
			)
		);
		for ( const changed of result.changedPaths.slice( 0, 20 ) ) {
			console.log( `  ${ changed }` );
		}
		if ( result.changedPaths.length > 20 ) {
			console.log( sprintf( __( '  …and %d more' ), result.changedPaths.length - 20 ) );
		}
		return;
	}

	console.log( sprintf( __( 'Pulled into %s' ), siteUrl ) );
	if ( result.adminUsername ) {
		console.log(
			sprintf(
				__( 'Signed-in admin for this site is now "%s", taken from the live database.' ),
				result.adminUsername
			)
		);
	}
}

export async function runCommand(
	sitePath: string,
	options: {
		targetOverrides: Partial< DeployTarget >;
		includeDatabase: boolean;
		deleteRemoved: boolean;
		dryRun: boolean;
		skipConfirmation: boolean;
	},
	logger: Logger< LoggerAction > = defaultLogger
): Promise< PullResult > {
	let wasServerRunning = false;
	let site;

	try {
		await connectToDaemon();

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		site = await getSiteByFolder( sitePath );
		const target = resolveDeployTarget( site, options.targetOverrides );
		logger.reportSuccess( __( 'Site loaded' ) );

		if ( ! options.skipConfirmation && ! options.dryRun && ! process.send && process.stdin.isTTY ) {
			if ( ! ( await confirmPull( target, site.name ) ) ) {
				throw new LoggerError( __( 'Pull cancelled.' ), undefined, 'cancelled' );
			}
		}

		logger.reportStart(
			LoggerAction.INSTALL_SQLITE,
			__( 'Setting up SQLite integration, if needed…' )
		);
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured as needed' ) );

		// The site's own files and database are about to be replaced underneath
		// it, so the server comes down first and back up at the end.
		if ( ! options.dryRun ) {
			wasServerRunning = !! ( await isServerRunning( site.id ) );
			if ( wasServerRunning ) {
				logger.reportStart( LoggerAction.PREFLIGHT, __( 'Stopping the site…' ) );
				await stopWordPressServer( site.id );
				await clearSiteLatestCliPid( site.id );
				logger.reportSuccess( __( 'Site stopped' ) );
			}
		}

		const abortController = new AbortController();
		const abort = () => abortController.abort();
		process.once( 'SIGTERM', abort );
		process.once( 'SIGINT', abort );

		let result: PullResult;
		try {
			result = await pullSite( {
				site,
				target,
				includeDatabase: options.includeDatabase,
				deleteRemoved: options.deleteRemoved,
				dryRun: options.dryRun,
				signal: abortController.signal,
				logger,
			} );
		} finally {
			process.off( 'SIGTERM', abort );
			process.off( 'SIGINT', abort );
		}

		await emitCliEvent( { event: SITE_EVENTS.UPDATED, data: { siteId: site.id } } );

		if ( ! process.send ) {
			reportResult( result, getSiteUrl( site ) );
		}

		return result;
	} finally {
		try {
			if ( site && wasServerRunning ) {
				logger.reportStart( LoggerAction.SYNC_FILES, __( 'Starting the site…' ) );
				await startWordPressServer( site, logger );
				logger.reportSuccess( __( 'Site started' ) );
			}
		} finally {
			await disconnectFromDaemon();
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull',
		describe: __( 'Pull this site down from its server' ),
		builder: ( pullYargs ) =>
			pullYargs
				.option( 'host', {
					type: 'string',
					description: __( 'Server hostname, IP address, or a Host alias from your ~/.ssh/config' ),
				} )
				.option( 'user', { type: 'string', description: __( 'SSH user' ) } )
				.option( 'port', { type: 'number', description: __( 'SSH port' ) } )
				.option( 'identity-file', {
					type: 'string',
					normalize: true,
					description: __( 'Private key to authenticate with' ),
				} )
				.option( 'remote-path', {
					type: 'string',
					description: __( 'Absolute path of the WordPress directory on the server' ),
				} )
				.option( 'remote-url', {
					type: 'string',
					description: __( 'Address the live site is served from' ),
				} )
				.option( 'skip-database', {
					type: 'boolean',
					default: false,
					description: __( 'Download files only and leave the local database alone' ),
				} )
				.option( 'delete', {
					type: 'boolean',
					default: true,
					description: __( 'Remove local files that no longer exist on the server' ),
				} )
				.option( 'dry-run', {
					type: 'boolean',
					default: false,
					description: __( 'Report what would change without writing anything locally' ),
				} )
				.option( 'yes', {
					type: 'boolean',
					alias: 'y',
					default: false,
					description: __( 'Skip the confirmation prompt' ),
				} ),
		handler: async ( argv ) => {
			const flags = argv as {
				path: string;
				host?: string;
				user?: string;
				port?: number;
				identityFile?: string;
				remotePath?: string;
				remoteUrl?: string;
				skipDatabase: boolean;
				delete: boolean;
				dryRun: boolean;
				yes: boolean;
			};
			try {
				await runCommand( flags.path, {
					targetOverrides: {
						host: flags.host,
						user: flags.user,
						port: flags.port,
						identityFile: flags.identityFile,
						remotePath: flags.remotePath,
						remoteUrl: flags.remoteUrl,
					},
					includeDatabase: ! flags.skipDatabase,
					deleteRemoved: flags.delete,
					dryRun: flags.dryRun,
					skipConfirmation: flags.yes,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					defaultLogger.reportError( error );
				} else {
					defaultLogger.reportError( new LoggerError( __( 'Failed to pull the site' ), error ) );
				}
			}
		},
	} );
};
