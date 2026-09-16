import { IpcMainInvokeEvent, Notification } from 'electron';
import { deployProgressSchema, type DeployRequest } from '@studio/common/lib/deploy-events';
import {
	getDeployTargetErrors,
	parseDeployTarget,
	type DeployTarget,
} from '@studio/common/lib/deploy-target';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { __ } from '@wordpress/i18n';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { CliCommandError, executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { SiteServer } from 'src/site-server';

/** In-flight deploys, so a second one cannot start and the first can be stopped. */
const runningDeploys = new Map< string, () => void >();

function requireSite( siteId: string ) {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	return site;
}

export async function getDeployTarget(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< DeployTarget | undefined > {
	return requireSite( siteId ).details.deployTarget;
}

/**
 * Validates and stores the target by handing it to the CLI, so the desktop app
 * and the terminal write `cli.json` through exactly one code path.
 */
export async function saveDeployTarget(
	_event: IpcMainInvokeEvent,
	siteId: string,
	target: Partial< DeployTarget >
): Promise< DeployTarget > {
	const site = requireSite( siteId );

	const errors = getDeployTargetErrors( target );
	const firstError = Object.values( errors )[ 0 ];
	if ( firstError ) {
		throw new Error( firstError );
	}

	const parsed = parseDeployTarget( target );
	const args = [
		'deploy',
		'set',
		'--path',
		site.details.path,
		'--host',
		parsed.host,
		'--remote-path',
		parsed.remotePath,
		'--remote-url',
		parsed.remoteUrl,
		parsed.deleteRemoved === false ? '--no-delete' : '--delete',
	];

	if ( parsed.user ) {
		args.push( '--user', parsed.user );
	}
	if ( parsed.port ) {
		args.push( '--port', String( parsed.port ) );
	}
	if ( parsed.identityFile ) {
		args.push( '--identity-file', parsed.identityFile );
	}

	const [ emitter ] = executeCliCommand( args, { output: 'capture', logPrefix: siteId } );

	await new Promise< void >( ( resolve, reject ) => {
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );

	return parsed;
}

export interface DeployOutcome {
	completed: boolean;
	warnings: string[];
}

/**
 * Runs the deploy, forwarding each step the CLI reports to the renderer.
 *
 * `--yes` is passed because the renderer already asked: the CLI's own prompt
 * has no terminal to read from here and would otherwise be skipped silently.
 */
export async function deploySite(
	_event: IpcMainInvokeEvent,
	siteId: string,
	request: DeployRequest = {}
): Promise< DeployOutcome > {
	const site = requireSite( siteId );

	if ( runningDeploys.has( siteId ) ) {
		throw new Error( __( 'A deploy is already running for this site.' ) );
	}

	const args = [ 'deploy', '--path', site.details.path, '--yes', '--no-save' ];
	if ( request.skipDatabase ) {
		args.push( '--skip-database' );
	}
	if ( request.backup === false ) {
		args.push( '--no-backup' );
	}
	if ( request.dryRun ) {
		args.push( '--dry-run' );
	}

	const [ emitter, childProcess ] = executeCliCommand( args, {
		output: 'capture',
		logPrefix: siteId,
	} );

	const warnings: string[] = [];
	let lastFailureMessage: string | undefined;

	runningDeploys.set( siteId, () => childProcess.kill( 'SIGTERM' ) );

	void sendIpcEventToRenderer( 'on-deploy', {
		siteId,
		status: 'inprogress',
		message: __( 'Starting deploy…' ),
	} );

	emitter.on( 'data', ( { data } ) => {
		const parsed = deployProgressSchema.safeParse( data );
		if ( ! parsed.success ) {
			return;
		}

		if ( parsed.data.status === 'warning' ) {
			warnings.push( parsed.data.message );
		}
		if ( parsed.data.status === 'fail' ) {
			lastFailureMessage = parsed.data.message;
		}

		void sendIpcEventToRenderer( 'on-deploy', {
			siteId,
			status: parsed.data.status,
			message: parsed.data.message,
		} );
	} );

	try {
		await new Promise< void >( ( resolve, reject ) => {
			emitter.on( 'success', () => resolve() );
			emitter.on( 'failure', ( { error } ) => reject( error ) );
			emitter.on( 'error', ( { error } ) => reject( error ) );
		} );
	} catch ( error ) {
		// The CLI reports the real reason through its progress messages; the
		// process-level error is just a non-zero exit code.
		const message =
			lastFailureMessage ??
			( error instanceof CliCommandError
				? error.lastErrorMessage ?? __( 'The deploy failed.' )
				: getErrorMessage( error ) ?? __( 'The deploy failed.' ) );

		void sendIpcEventToRenderer( 'on-deploy', { siteId, status: 'fail', message } );
		throw new Error( message );
	} finally {
		runningDeploys.delete( siteId );
	}

	if ( ! request.dryRun ) {
		new Notification( {
			title: site.details.name,
			body: __( 'Deploy completed' ),
		} ).show();
	}

	void sendIpcEventToRenderer( 'on-deploy', {
		siteId,
		status: 'success',
		message: request.dryRun ? __( 'Dry run complete' ) : __( 'Deploy complete' ),
	} );

	return { completed: true, warnings };
}

export async function cancelDeploy( _event: IpcMainInvokeEvent, siteId: string ): Promise< void > {
	runningDeploys.get( siteId )?.();
}
