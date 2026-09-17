import { createInterface } from 'node:readline/promises';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import {
	describeDeployTarget,
	getSshDestination,
	type DeployTarget,
} from '@studio/common/lib/deploy-target';
import { DeployCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { deploySite, type DeployResult } from 'cli/lib/deploy/deploy-manager';
import {
	clearDeployTarget,
	resolveDeployTarget,
	saveDeployTarget,
} from 'cli/lib/deploy/target-store';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

interface TargetFlags {
	host?: string;
	user?: string;
	port?: number;
	identityFile?: string;
	remotePath?: string;
	remoteUrl?: string;
	delete?: boolean;
}

function toTargetOverrides( flags: TargetFlags ): Partial< DeployTarget > {
	return {
		host: flags.host,
		user: flags.user,
		port: flags.port,
		identityFile: flags.identityFile,
		remotePath: flags.remotePath,
		remoteUrl: flags.remoteUrl,
		deleteRemoved: flags.delete,
	};
}

/**
 * The connection flags, shared by `deploy` and `deploy set` so a one-off push
 * and a saved target are described exactly the same way.
 */
function addTargetOptions( yargs: StudioArgv ) {
	return yargs
		.option( 'host', {
			type: 'string',
			description: __( 'Server hostname, IP address, or a Host alias from your ~/.ssh/config' ),
		} )
		.option( 'user', {
			type: 'string',
			description: __( 'SSH user. Can also be given as user@host.' ),
		} )
		.option( 'port', {
			type: 'number',
			description: __( 'SSH port. Defaults to whatever your SSH config uses.' ),
		} )
		.option( 'identity-file', {
			type: 'string',
			normalize: true,
			description: __( 'Private key to authenticate with, passed to ssh as -i' ),
		} )
		.option( 'remote-path', {
			type: 'string',
			description: __( 'Absolute path of the WordPress directory on the server' ),
		} )
		.option( 'remote-url', {
			type: 'string',
			description: __( 'Address the deployed site is served from, e.g. https://example.com' ),
		} );
}

function printTarget( target: DeployTarget | undefined ): void {
	if ( ! target ) {
		console.log( __( 'No server is set up for this site. Run `studio deploy set` to add one.' ) );
		return;
	}

	const rows: Array< [ string, string ] > = [
		[ __( 'Host' ), getSshDestination( target ) ],
		[ __( 'Port' ), target.port ? String( target.port ) : __( '(from SSH config)' ) ],
		[ __( 'Key' ), target.identityFile ?? __( '(from SSH agent or config)' ) ],
		[ __( 'Remote path' ), target.remotePath ],
		[ __( 'Remote URL' ), target.remoteUrl ],
		[ __( 'Delete removed files' ), target.deleteRemoved === false ? __( 'no' ) : __( 'yes' ) ],
	];

	const width = Math.max( ...rows.map( ( [ label ] ) => label.length ) );
	for ( const [ label, value ] of rows ) {
		console.log( `${ label.padEnd( width ) }  ${ value }` );
	}
}

/**
 * Asks before overwriting a live site. Only reachable from a terminal: when the
 * desktop app runs the command it has already confirmed with the user, and
 * there is no stdin to read from.
 */
async function confirmPush( target: DeployTarget, localUrl: string ): Promise< boolean > {
	const readline = createInterface( { input: process.stdin, output: process.stdout } );
	try {
		console.log(
			sprintf( __( 'About to push %1$s to %2$s.' ), localUrl, describeDeployTarget( target ) )
		);
		console.log(
			__(
				'This replaces the files and the database on the server. Content added there since the last push will be lost.'
			)
		);
		const answer = await readline.question( __( 'Continue? [y/N] ' ) );
		return /^y(es)?$/i.test( answer.trim() );
	} finally {
		readline.close();
	}
}

function reportResult( result: DeployResult, target: DeployTarget ): void {
	if ( result.dryRun ) {
		console.log(
			sprintf(
				__( 'Dry run: %d file(s) would be copied. Nothing was changed on the server.' ),
				result.filesTransferred
			)
		);
		if ( result.changedPaths.length ) {
			for ( const changed of result.changedPaths.slice( 0, 20 ) ) {
				console.log( `  ${ changed }` );
			}
			if ( result.changedPaths.length > 20 ) {
				console.log( sprintf( __( '  …and %d more' ), result.changedPaths.length - 20 ) );
			}
		}
		return;
	}

	console.log( sprintf( __( 'Deployed to %s' ), target.remoteUrl ) );
	if ( result.remoteBackupPath ) {
		console.log(
			sprintf(
				__( 'The previous database was saved on the server at %s' ),
				result.remoteBackupPath
			)
		);
	}
}

export async function runCommand(
	sitePath: string,
	options: {
		targetOverrides: Partial< DeployTarget >;
		includeDatabase: boolean;
		backupRemoteDatabase: boolean;
		dryRun: boolean;
		save: boolean;
		skipConfirmation: boolean;
	},
	logger: Logger< LoggerAction > = defaultLogger
): Promise< DeployResult > {
	try {
		await connectToDaemon();

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( sitePath );
		const target = resolveDeployTarget( site, options.targetOverrides );
		logger.reportSuccess( __( 'Site loaded' ) );

		// Only when the command actually carried connection flags: a plain
		// `studio deploy` should not rewrite cli.json on every run.
		const hasOverrides = Object.values( options.targetOverrides ).some(
			( value ) => value !== undefined
		);
		if ( options.save && hasOverrides ) {
			await saveDeployTarget( sitePath, target );
			await notifySiteUpdated( sitePath );
		}

		if ( ! options.skipConfirmation && ! options.dryRun && ! process.send && process.stdin.isTTY ) {
			const confirmed = await confirmPush( target, getSiteUrl( site ) );
			if ( ! confirmed ) {
				throw new LoggerError( __( 'Deploy cancelled.' ), undefined, 'cancelled' );
			}
		}

		if ( options.includeDatabase ) {
			logger.reportStart(
				LoggerAction.INSTALL_SQLITE,
				__( 'Setting up SQLite integration, if needed…' )
			);
			await keepSqliteIntegrationUpdated( sitePath );
			logger.reportSuccess( __( 'SQLite integration configured as needed' ) );
		}

		// Stopping a deploy has to reach rsync and ssh, which are grandchildren of
		// whoever sent the signal. Without this they keep writing to the server
		// after the CLI is gone.
		const abortController = new AbortController();
		const abort = () => abortController.abort();
		process.once( 'SIGTERM', abort );
		process.once( 'SIGINT', abort );

		let result;
		try {
			result = await deploySite( {
				site,
				target,
				includeDatabase: options.includeDatabase,
				backupRemoteDatabase: options.backupRemoteDatabase,
				dryRun: options.dryRun,
				signal: abortController.signal,
				logger,
			} );
		} finally {
			process.off( 'SIGTERM', abort );
			process.off( 'SIGINT', abort );
		}

		if ( ! process.send ) {
			reportResult( result, target );
		}

		return result;
	} finally {
		await disconnectFromDaemon();
	}
}

/** The three verbs that manage where a site is pushed to and pulled from. */
function registerServerSubcommands( serverYargs: StudioArgv ): StudioArgv {
	return serverYargs
		.command( {
			command: 'set',
			describe: __( 'Save the server this site pushes to and pulls from' ),
			builder: ( setYargs ) =>
				addTargetOptions( setYargs as StudioArgv ).option( 'delete', {
					type: 'boolean',
					description: __( 'Whether pushing removes server files that no longer exist locally' ),
				} ),
			handler: async ( argv ) => {
				try {
					const sitePath = argv.path as string;
					const target = await saveDeployTarget(
						sitePath,
						toTargetOverrides( argv as TargetFlags )
					);
					await notifySiteUpdated( sitePath );
					console.log( __( 'Saved.' ) );
					printTarget( target );
				} catch ( error ) {
					reportFailure( error, __( 'Failed to save the server' ) );
				}
			},
		} )
		.command( {
			command: 'show',
			describe: __( 'Show the server this site pushes to and pulls from' ),
			handler: async ( argv ) => {
				try {
					const site = await getSiteByFolder( argv.path as string );
					printTarget( site.deployTarget );
				} catch ( error ) {
					reportFailure( error, __( 'Failed to read the server' ) );
				}
			},
		} )
		.command( {
			command: 'forget',
			describe: __( 'Remove the saved server for this site' ),
			handler: async ( argv ) => {
				try {
					const sitePath = argv.path as string;
					await clearDeployTarget( sitePath );
					await notifySiteUpdated( sitePath );
					console.log( __( 'Removed.' ) );
				} catch ( error ) {
					reportFailure( error, __( 'Failed to remove the server' ) );
				}
			},
		} );
}

function addPushOptions( pushYargs: StudioArgv ): StudioArgv {
	return addTargetOptions( pushYargs )
		.option( 'skip-database', {
			type: 'boolean',
			default: false,
			description: __( 'Copy files only and leave the server database alone' ),
		} )
		.option( 'backup', {
			type: 'boolean',
			default: true,
			description: __( 'Save a copy of the server database before replacing it' ),
		} )
		.option( 'delete', {
			type: 'boolean',
			description: __( 'Remove server files that no longer exist locally' ),
		} )
		.option( 'dry-run', {
			type: 'boolean',
			default: false,
			description: __( 'Report what would change without writing to the server' ),
		} )
		.option( 'save', {
			type: 'boolean',
			default: true,
			description: __( 'Remember these connection settings for next time' ),
		} )
		.option( 'yes', {
			type: 'boolean',
			alias: 'y',
			default: false,
			description: __( 'Skip the confirmation prompt' ),
		} );
}

async function handlePush( argv: unknown ): Promise< void > {
	const flags = argv as TargetFlags & {
		path: string;
		skipDatabase: boolean;
		backup: boolean;
		dryRun: boolean;
		save: boolean;
		yes: boolean;
	};
	try {
		await runCommand( flags.path, {
			targetOverrides: toTargetOverrides( flags ),
			includeDatabase: ! flags.skipDatabase,
			backupRemoteDatabase: flags.backup,
			dryRun: flags.dryRun,
			save: flags.save,
			skipConfirmation: flags.yes,
		} );
	} catch ( error ) {
		reportFailure( error, __( 'Failed to push the site' ) );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	// `server` holds the destination; `push` and `pull` move a site across it.
	yargs.command( 'server', __( 'Manage the server this site is linked to' ), ( serverYargs ) => {
		registerServerSubcommands( serverYargs as StudioArgv )
			.version( false )
			.demandCommand( 1, __( 'You must provide a valid server command' ) );

		return serverYargs;
	} );

	yargs.command( {
		command: 'push',
		describe: __( 'Push this site up to its server' ),
		builder: ( pushYargs ) => addPushOptions( pushYargs as StudioArgv ),
		handler: handlePush,
	} );

	// The `deploy` group this replaced, kept hidden so existing scripts and
	// anything the desktop app has already recorded keep working.
	return yargs.command( 'deploy', false, ( deployYargs ) => {
		registerServerSubcommands( deployYargs as StudioArgv )
			.command( {
				command: '$0',
				describe: __( 'Push this site up to its server' ),
				builder: ( pushYargs ) => addPushOptions( pushYargs as StudioArgv ),
				handler: handlePush,
			} )
			.version( false );

		return deployYargs;
	} );
};

/**
 * Tells the desktop app the site changed, so its Manage tab reflects a server
 * edited from the terminal (and its own edits, which go through this command).
 */
async function notifySiteUpdated( sitePath: string ): Promise< void > {
	try {
		const site = await getSiteByFolder( sitePath );
		await connectToDaemon();
		await emitCliEvent( { event: SITE_EVENTS.UPDATED, data: { siteId: site.id } } );
	} catch {
		// A running desktop app is optional; the config file is already saved.
	} finally {
		await disconnectFromDaemon();
	}
}

function reportFailure( error: unknown, fallbackMessage: string ): void {
	if ( error instanceof LoggerError ) {
		defaultLogger.reportError( error );
		return;
	}
	defaultLogger.reportError( new LoggerError( fallbackMessage, error ) );
}
