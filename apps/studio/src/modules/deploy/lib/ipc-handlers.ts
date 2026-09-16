import { IpcMainInvokeEvent, Notification } from 'electron';
import {
	deployProgressSchema,
	type DeployRequest,
	type TransferKind,
} from '@studio/common/lib/deploy-events';
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

/** In-flight transfers, so a second cannot start and the first can be stopped. */
const runningTransfers = new Map< string, () => void >();

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
 * Runs a transfer, forwarding each step the CLI reports to the renderer.
 *
 * Deploy and pull share this because they share a shape: one CLI process per
 * site, progress arriving as logger messages, and a UI that shows one status
 * line either way. `--yes` is passed because the renderer already asked; the
 * CLI's own prompt has no terminal here and would otherwise be skipped
 * without anyone confirming.
 */
async function runTransfer(
	kind: TransferKind,
	siteId: string,
	request: DeployRequest
): Promise< DeployOutcome > {
	const site = requireSite( siteId );

	if ( runningTransfers.has( siteId ) ) {
		throw new Error( __( 'A transfer is already running for this site.' ) );
	}

	const args = [ kind === 'pull' ? 'pull' : 'deploy', '--path', site.details.path, '--yes' ];
	if ( kind === 'deploy' ) {
		args.push( '--no-save' );
	}
	if ( request.skipDatabase ) {
		args.push( '--skip-database' );
	}
	if ( kind === 'deploy' && request.backup === false ) {
		args.push( '--no-backup' );
	}
	if ( kind === 'pull' && request.deleteRemoved === false ) {
		args.push( '--no-delete' );
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

	runningTransfers.set( siteId, () => childProcess.kill( 'SIGTERM' ) );

	void sendIpcEventToRenderer( 'on-deploy', {
		siteId,
		kind,
		status: 'inprogress',
		message: kind === 'pull' ? __( 'Starting pull…' ) : __( 'Starting deploy…' ),
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
			kind,
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
		const fallback = kind === 'pull' ? __( 'The pull failed.' ) : __( 'The deploy failed.' );
		const message =
			lastFailureMessage ??
			( error instanceof CliCommandError
				? error.lastErrorMessage ?? fallback
				: getErrorMessage( error ) ?? fallback );

		void sendIpcEventToRenderer( 'on-deploy', { siteId, kind, status: 'fail', message } );
		throw new Error( message );
	} finally {
		runningTransfers.delete( siteId );
	}

	if ( ! request.dryRun ) {
		new Notification( {
			title: site.details.name,
			body: kind === 'pull' ? __( 'Pull completed' ) : __( 'Deploy completed' ),
		} ).show();
	}

	void sendIpcEventToRenderer( 'on-deploy', {
		siteId,
		kind,
		status: 'success',
		message: request.dryRun
			? __( 'Dry run complete' )
			: kind === 'pull'
			? __( 'Pull complete' )
			: __( 'Deploy complete' ),
	} );

	return { completed: true, warnings };
}

export async function deploySite(
	_event: IpcMainInvokeEvent,
	siteId: string,
	request: DeployRequest = {}
): Promise< DeployOutcome > {
	return runTransfer( 'deploy', siteId, request );
}

export async function pullSite(
	_event: IpcMainInvokeEvent,
	siteId: string,
	request: DeployRequest = {}
): Promise< DeployOutcome > {
	return runTransfer( 'pull', siteId, request );
}

/** Stops whichever transfer is running for this site, deploy or pull. */
export async function cancelDeploy( _event: IpcMainInvokeEvent, siteId: string ): Promise< void > {
	runningTransfers.get( siteId )?.();
}
