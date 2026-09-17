/**
 * Reads and writes the deploy target stored on a site in `cli.json`.
 */
import { parseDeployTarget, type DeployTarget } from '@studio/common/lib/deploy-target';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { __ } from '@wordpress/i18n';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
	type SiteData,
} from 'cli/lib/cli-config/core';
import { LoggerError } from 'cli/logger';

/**
 * Merges `changes` into the site's stored target and validates the result, so
 * a single field can be corrected without restating the whole thing.
 *
 * Fields left out are dropped before merging rather than written as undefined,
 * which is what lets `deploy set --remote-url ...` keep the existing host.
 */
export async function saveDeployTarget(
	sitePath: string,
	changes: Partial< DeployTarget >
): Promise< DeployTarget > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( candidate ) => arePathsEqual( candidate.path, sitePath ) );

		if ( ! site ) {
			throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
		}

		const target = parseDeployTarget( { ...site.deployTarget, ...stripUndefined( changes ) } );
		site.deployTarget = target;
		await saveCliConfig( config );

		return target;
	} finally {
		await unlockCliConfig();
	}
}

export async function clearDeployTarget( sitePath: string ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( candidate ) => arePathsEqual( candidate.path, sitePath ) );

		if ( ! site ) {
			throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
		}

		delete site.deployTarget;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

/**
 * Resolves the target a push should use: the stored one, with any flags given
 * on the command line layered on top.
 */
export function resolveDeployTarget(
	site: SiteData,
	overrides: Partial< DeployTarget >
): DeployTarget {
	const merged = { ...site.deployTarget, ...stripUndefined( overrides ) };

	if ( ! merged.host && ! merged.remotePath && ! merged.remoteUrl ) {
		throw new LoggerError(
			__(
				'This site has no server set up yet. Run `studio server set --host <server> --remote-path <path> --remote-url <url>` first.'
			),
			undefined,
			'no_deploy_target'
		);
	}

	return parseDeployTarget( merged );
}

function stripUndefined< T extends object >( value: T ): Partial< T > {
	return Object.fromEntries(
		Object.entries( value ).filter( ( [ , entry ] ) => entry !== undefined )
	) as Partial< T >;
}
