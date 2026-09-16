/**
 * Thin wrappers around the system `ssh` and `rsync`.
 *
 * Shelling out rather than using an SSH library is deliberate: it reuses the
 * user's existing `~/.ssh/config`, agent, jump hosts and hardware keys, so a
 * host that already works in their terminal works here with no extra setup,
 * and Studio never handles a private key or passphrase itself.
 */
import { spawn } from 'node:child_process';
import {
	getRsyncShellCommand,
	getSshDestination,
	getSshOptionArgs,
	type DeployTarget,
} from '@studio/common/lib/deploy-target';
import { __, sprintf } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

/** Seconds ssh waits for the TCP connection before giving up. */
const CONNECT_TIMEOUT_SECONDS = 15;

export interface RemoteResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	signal?: AbortSignal;
	/** Called with each line the command writes to stdout. */
	onStdoutLine?: ( line: string ) => void;
	/** Called with each line the command writes to stderr. */
	onStderrLine?: ( line: string ) => void;
}

/**
 * ssh must never sit waiting for a passphrase or a yes/no answer when nothing
 * can type one. In IPC mode the desktop app owns stdin, and a detached run has
 * no terminal at all, so both get BatchMode and fail fast with a real message.
 */
function isInteractive(): boolean {
	return ! process.send && Boolean( process.stdin.isTTY );
}

function getConnectionOptions(): string[] {
	const options = [
		'-o',
		`ConnectTimeout=${ CONNECT_TIMEOUT_SECONDS }`,
		// Deploys run several commands back to back; one authentication is enough.
		'-o',
		'ControlMaster=no',
	];
	if ( ! isInteractive() ) {
		options.push( '-o', 'BatchMode=yes' );
	}
	return options;
}

/**
 * Turns the opaque exit codes ssh and rsync return into something the user can
 * act on. The original stderr is kept as the cause so nothing is lost.
 */
function describeSshFailure( stderr: string, code: number ): LoggerError {
	const text = stderr.toLowerCase();

	if ( text.includes( 'host key verification failed' ) ) {
		return new LoggerError(
			__(
				'The server’s host key is not trusted yet. Connect to it once from your terminal with `ssh` to review and accept the key, then deploy again.'
			),
			undefined,
			'ssh_host_key'
		);
	}
	if (
		text.includes( 'could not resolve hostname' ) ||
		text.includes( 'name or service not known' )
	) {
		return new LoggerError(
			__( 'The server hostname could not be resolved.' ),
			undefined,
			'ssh_dns'
		);
	}
	if ( text.includes( 'connection refused' ) ) {
		return new LoggerError(
			__( 'The server refused the connection. Check the host and port.' ),
			undefined,
			'ssh_refused'
		);
	}
	if ( text.includes( 'connection timed out' ) || text.includes( 'operation timed out' ) ) {
		return new LoggerError(
			__( 'The connection to the server timed out.' ),
			undefined,
			'ssh_timeout'
		);
	}
	if ( text.includes( 'permission denied' ) ) {
		return new LoggerError(
			__(
				'The server rejected the SSH key. Add the key to your agent with `ssh-add`, or set the key file on the deploy target.'
			),
			undefined,
			'ssh_auth'
		);
	}
	if ( text.includes( 'batchmode' ) || text.includes( 'passphrase' ) ) {
		return new LoggerError(
			__(
				'The SSH key needs a passphrase that cannot be entered here. Load the key into your agent first with `ssh-add`.'
			),
			undefined,
			'ssh_passphrase'
		);
	}

	const detail = stderr.trim().split( '\n' ).slice( -3 ).join( ' ' );
	return new LoggerError(
		detail
			? sprintf( __( 'The SSH command failed (exit code %1$d): %2$s' ), code, detail )
			: sprintf( __( 'The SSH command failed with exit code %d.' ), code ),
		undefined,
		'ssh_failed'
	);
}

function run(
	command: string,
	args: string[],
	options: RunOptions & { stdin?: string }
): Promise< RemoteResult > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( command, args, {
			stdio: [ options.stdin === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe' ],
			signal: options.signal,
		} );

		let stdout = '';
		let stderr = '';
		let stdoutBuffer = '';
		let stderrBuffer = '';

		const drain = ( buffer: string, onLine?: ( line: string ) => void ): string => {
			if ( ! onLine ) {
				return '';
			}
			const lines = buffer.split( '\n' );
			const remainder = lines.pop() ?? '';
			for ( const line of lines ) {
				onLine( line );
			}
			return remainder;
		};

		child.stdout?.on( 'data', ( chunk: Buffer ) => {
			const text = chunk.toString();
			stdout += text;
			stdoutBuffer = drain( stdoutBuffer + text, options.onStdoutLine );
		} );
		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			const text = chunk.toString();
			stderr += text;
			stderrBuffer = drain( stderrBuffer + text, options.onStderrLine );
		} );

		child.on( 'error', ( error: NodeJS.ErrnoException ) => {
			if ( error.code === 'ENOENT' ) {
				reject(
					new LoggerError(
						sprintf(
							__( '`%s` was not found on this computer. Install it and try again.' ),
							command
						),
						error,
						'missing_binary'
					)
				);
				return;
			}
			if ( error.name === 'AbortError' ) {
				reject( new LoggerError( __( 'Deploy cancelled.' ), error, 'cancelled' ) );
				return;
			}
			reject(
				new LoggerError( sprintf( __( 'Failed to run `%s`.' ), command ), error, 'spawn_failed' )
			);
		} );

		child.on( 'close', ( code ) => {
			if ( options.onStdoutLine && stdoutBuffer ) {
				options.onStdoutLine( stdoutBuffer );
			}
			if ( options.onStderrLine && stderrBuffer ) {
				options.onStderrLine( stderrBuffer );
			}
			resolve( { code: code ?? 1, stdout, stderr } );
		} );

		if ( options.stdin !== undefined ) {
			child.stdin?.end( options.stdin );
		}
	} );
}

/**
 * Runs a bash script on the server by piping it to `bash -s` over stdin.
 *
 * Passing the script on stdin rather than as an argument keeps it out of the
 * remote process list — the fallback database import puts credentials in it —
 * and avoids a second layer of shell quoting.
 */
export async function runRemoteScript(
	target: DeployTarget,
	script: string,
	options: RunOptions = {}
): Promise< RemoteResult > {
	const args = [
		...getConnectionOptions(),
		...getSshOptionArgs( target ),
		getSshDestination( target ),
		'bash -s',
	];

	const result = await run( 'ssh', args, { ...options, stdin: script } );

	// 255 is ssh's own "the connection failed" code, so it is the only one that
	// is definitely a transport problem rather than the script's exit status.
	if ( result.code === 255 ) {
		throw describeSshFailure( result.stderr, result.code );
	}

	return result;
}

export interface RsyncOptions extends RunOptions {
	/** Local directory to copy from. A trailing slash is added for you. */
	localPath: string;
	/** Remote directory to copy into. */
	remotePath: string;
	/** Paths rsync should skip, in .gitignore-style syntax. */
	excludeFile?: string;
	/** Remove remote files that no longer exist locally. */
	deleteRemoved: boolean;
	/** Report what would change without changing anything. */
	dryRun?: boolean;
	/** Called as files are transferred, with the running count. */
	onFileTransferred?: ( count: number, path: string ) => void;
}

export interface RsyncResult {
	filesTransferred: number;
	/** Paths rsync reported, capped so a huge first deploy cannot exhaust memory. */
	paths: string[];
}

const MAX_REPORTED_PATHS = 500;

/**
 * Copies the site directory to the server.
 *
 * `--out-format=%n` is used instead of `--info=progress2` because macOS ships
 * openrsync, which reports itself as rsync 2.6.9 and does not understand the
 * newer progress flag. Counting the file names it prints works everywhere.
 */
export async function runRsync(
	target: DeployTarget,
	options: RsyncOptions
): Promise< RsyncResult > {
	const args = [ '-rlptz', '--out-format=%n', '-e', getRsyncShellCommand( target ) ];

	if ( options.deleteRemoved ) {
		args.push( '--delete' );
	}
	if ( options.dryRun ) {
		args.push( '--dry-run' );
	}
	if ( options.excludeFile ) {
		args.push( `--exclude-from=${ options.excludeFile }` );
	}

	const source = options.localPath.endsWith( '/' ) ? options.localPath : `${ options.localPath }/`;
	args.push( source, `${ getSshDestination( target ) }:${ options.remotePath }/` );

	let filesTransferred = 0;
	const paths: string[] = [];

	const result = await run( 'rsync', args, {
		signal: options.signal,
		onStderrLine: options.onStderrLine,
		onStdoutLine: ( line ) => {
			const path = line.trim();
			// rsync prints "./" for the destination directory itself, and blank
			// lines between its summary sections.
			if ( ! path || path === './' ) {
				return;
			}
			filesTransferred += 1;
			if ( paths.length < MAX_REPORTED_PATHS ) {
				paths.push( path );
			}
			options.onFileTransferred?.( filesTransferred, path );
		},
	} );

	if ( result.code !== 0 ) {
		// rsync returns 255 when its ssh transport fails, and its own codes otherwise.
		if ( result.code === 255 || /ssh|permission denied|host key/i.test( result.stderr ) ) {
			throw describeSshFailure( result.stderr, result.code );
		}
		const detail = result.stderr.trim().split( '\n' ).slice( -3 ).join( ' ' );
		throw new LoggerError(
			sprintf(
				__( 'Copying files to the server failed: %s' ),
				detail || `rsync exit ${ result.code }`
			),
			undefined,
			'rsync_failed'
		);
	}

	return { filesTransferred, paths };
}

/** Copies a single local file to an absolute path on the server. */
export async function uploadFile(
	target: DeployTarget,
	localPath: string,
	remotePath: string,
	options: RunOptions = {}
): Promise< void > {
	const args = [
		'-z',
		'-e',
		getRsyncShellCommand( target ),
		localPath,
		`${ getSshDestination( target ) }:${ remotePath }`,
	];

	const result = await run( 'rsync', args, options );

	if ( result.code !== 0 ) {
		if ( result.code === 255 ) {
			throw describeSshFailure( result.stderr, result.code );
		}
		throw new LoggerError(
			sprintf(
				__( 'Uploading the database to the server failed: %s' ),
				result.stderr.trim().split( '\n' ).slice( -2 ).join( ' ' ) || `rsync exit ${ result.code }`
			),
			undefined,
			'upload_failed'
		);
	}
}
