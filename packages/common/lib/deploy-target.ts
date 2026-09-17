/**
 * The server a site is pushed to, and the rules for talking to it.
 *
 * Deploys shell out to the system `ssh` and `rsync`, so a `host` may be a real
 * hostname or an alias from the user's `~/.ssh/config`. That keeps jump hosts,
 * per-host keys and non-standard ports working without re-implementing any of
 * it here, and means credentials never pass through Studio.
 */
import { z } from 'zod';

export const deployTargetSchema = z.object( {
	/** Hostname, IP, or a Host alias defined in the user's ~/.ssh/config. */
	host: z.string().min( 1 ),
	/** SSH user. Omitted when the ssh config (or the URL form user@host) supplies one. */
	user: z.string().optional(),
	/** SSH port. Omitted means the ssh config's value, or 22. */
	port: z.number().int().positive().max( 65535 ).optional(),
	/** Path to a private key, passed as `ssh -i`. Omitted means the agent or ssh config decides. */
	identityFile: z.string().optional(),
	/** Absolute path of the WordPress root on the server. */
	remotePath: z.string().min( 1 ),
	/** The URL the deployed site is served from, e.g. https://example.com. */
	remoteUrl: z.string().min( 1 ),
	/** Whether rsync deletes remote files that no longer exist locally. Defaults to true. */
	deleteRemoved: z.boolean().optional(),
} );

export type DeployTarget = z.infer< typeof deployTargetSchema >;

export class DeployTargetError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'DeployTargetError';
	}
}

/**
 * Splits a `user@host` shorthand so either form can be typed into the host field.
 */
export function splitUserHost( value: string ): { user?: string; host: string } {
	const at = value.lastIndexOf( '@' );
	if ( at <= 0 ) {
		return { host: value };
	}
	return { user: value.slice( 0, at ), host: value.slice( at + 1 ) };
}

/**
 * Trailing slashes make rsync destinations and URL replacements ambiguous, so
 * they are stripped once here rather than at each use.
 */
export function normalizeRemotePath( remotePath: string ): string {
	const trimmed = remotePath.trim().replace( /\/+$/, '' );
	return trimmed === '' ? '/' : trimmed;
}

export function normalizeRemoteUrl( remoteUrl: string ): string {
	// The scheme is settled before any trailing slash is stripped, so that a
	// value of "http://" is left visibly broken for validation to reject rather
	// than being turned into a host named "http".
	const trimmed = remoteUrl.trim();
	const withScheme = /^https?:\/\//i.test( trimmed ) ? trimmed : `https://${ trimmed }`;
	return withScheme.replace( /\/+$/, '' );
}

/**
 * Field-level validation with messages aimed at the person filling the form.
 * Returns one message per invalid field, keyed by field name.
 */
export function getDeployTargetErrors(
	target: Partial< DeployTarget >
): Partial< Record< keyof DeployTarget, string > > {
	const errors: Partial< Record< keyof DeployTarget, string > > = {};

	if ( ! target.host?.trim() ) {
		errors.host = 'Enter the server hostname, IP address, or an SSH config alias.';
	} else if ( /\s/.test( target.host.trim() ) ) {
		errors.host = 'The host cannot contain spaces.';
	}

	if (
		target.port !== undefined &&
		( ! Number.isInteger( target.port ) || target.port < 1 || target.port > 65535 )
	) {
		errors.port = 'The port must be a whole number between 1 and 65535.';
	}

	const remotePath = target.remotePath?.trim();
	if ( ! remotePath ) {
		errors.remotePath = 'Enter the full path to the WordPress directory on the server.';
	} else if ( ! remotePath.startsWith( '/' ) && ! remotePath.startsWith( '~' ) ) {
		errors.remotePath = 'The remote path must be absolute, for example /home/user/webapps/mysite.';
	} else if ( remotePath === '/' ) {
		errors.remotePath = 'Refusing to deploy to the filesystem root.';
	}

	const remoteUrl = target.remoteUrl?.trim();
	if ( ! remoteUrl ) {
		errors.remoteUrl = 'Enter the address the deployed site is served from.';
	} else {
		let parsed: URL | undefined;
		try {
			parsed = new URL( normalizeRemoteUrl( remoteUrl ) );
		} catch {
			parsed = undefined;
		}
		if ( ! parsed || ! parsed.hostname ) {
			errors.remoteUrl = 'Enter a valid address, for example https://example.com.';
		}
	}

	return errors;
}

/**
 * Validates and normalizes in one step. Throws on the first problem so callers
 * that cannot show per-field errors still fail with something actionable.
 */
export function parseDeployTarget( input: Partial< DeployTarget > ): DeployTarget {
	const merged: Partial< DeployTarget > = { ...input };

	if ( merged.host ) {
		const { user, host } = splitUserHost( merged.host.trim() );
		merged.host = host;
		if ( user && ! merged.user ) {
			merged.user = user;
		}
	}

	const errors = getDeployTargetErrors( merged );
	const firstError = Object.values( errors )[ 0 ];
	if ( firstError ) {
		throw new DeployTargetError( firstError );
	}

	return deployTargetSchema.parse( {
		...merged,
		host: merged.host!.trim(),
		user: merged.user?.trim() || undefined,
		identityFile: merged.identityFile?.trim() || undefined,
		remotePath: normalizeRemotePath( merged.remotePath! ),
		remoteUrl: normalizeRemoteUrl( merged.remoteUrl! ),
	} );
}

/** The `[user@]host` argument for ssh, rsync and scp. */
export function getSshDestination( target: DeployTarget ): string {
	return target.user ? `${ target.user }@${ target.host }` : target.host;
}

/** Connection flags shared by every ssh invocation for this target. */
export function getSshOptionArgs( target: DeployTarget ): string[] {
	const args: string[] = [];
	if ( target.port ) {
		args.push( '-p', String( target.port ) );
	}
	if ( target.identityFile ) {
		args.push( '-i', target.identityFile );
	}
	return args;
}

/**
 * The same connection flags in the form rsync's `-e` expects, where the port
 * flag is `-p` for ssh but must be spelled out because rsync passes the string
 * to a shell.
 */
export function getRsyncShellCommand( target: DeployTarget ): string {
	const parts = [ 'ssh' ];
	if ( target.port ) {
		parts.push( '-p', String( target.port ) );
	}
	if ( target.identityFile ) {
		parts.push( '-i', shellQuote( target.identityFile ) );
	}
	return parts.join( ' ' );
}

/** Single-quotes a value for safe interpolation into a remote shell command. */
export function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

/** A one-line summary for logs and confirmation prompts. */
export function describeDeployTarget( target: DeployTarget ): string {
	return `${ getSshDestination( target ) }:${ target.remotePath } (${ target.remoteUrl })`;
}
