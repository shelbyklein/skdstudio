import {
	INITIAL_DEPLOY_STATE,
	type DeployRequest,
	type DeployState,
} from '@studio/common/lib/deploy-events';
import { __ } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { DeployTarget } from '@studio/common/lib/deploy-target';

type DeployStateBySite = Record< string, DeployState >;

/**
 * Tracks deploy progress per site.
 *
 * The state is keyed by site so switching sites mid-deploy does not lose the
 * running one, and a deploy that finishes while another site is on screen still
 * shows its result when the user comes back.
 */
export function useDeploy() {
	const [ stateBySite, setStateBySite ] = useState< DeployStateBySite >( {} );

	const getState = useCallback(
		( siteId: string ): DeployState => stateBySite[ siteId ] ?? INITIAL_DEPLOY_STATE,
		[ stateBySite ]
	);

	useIpcListener( 'on-deploy', ( _event, progress ) => {
		setStateBySite( ( previous ) => {
			const current = previous[ progress.siteId ] ?? INITIAL_DEPLOY_STATE;

			if ( progress.status === 'fail' ) {
				return {
					...previous,
					[ progress.siteId ]: {
						...current,
						isDeploying: false,
						statusMessage: undefined,
						errorMessage: progress.message,
					},
				};
			}

			if ( progress.status === 'warning' ) {
				return {
					...previous,
					[ progress.siteId ]: {
						...current,
						warnings: [ ...current.warnings, progress.message ],
					},
				};
			}

			return {
				...previous,
				[ progress.siteId ]: {
					...current,
					isDeploying: true,
					statusMessage: progress.message,
				},
			};
		} );
	} );

	const deploy = useCallback( async ( siteId: string, request: DeployRequest = {} ) => {
		setStateBySite( ( previous ) => ( {
			...previous,
			[ siteId ]: {
				isDeploying: true,
				statusMessage: __( 'Starting deploy…' ),
				warnings: [],
			},
		} ) );

		try {
			await getIpcApi().deploySite( siteId, request );
			setStateBySite( ( previous ) => ( {
				...previous,
				[ siteId ]: {
					...( previous[ siteId ] ?? INITIAL_DEPLOY_STATE ),
					isDeploying: false,
					statusMessage: undefined,
					errorMessage: undefined,
					completedAt: Date.now(),
				},
			} ) );
			return true;
		} catch ( error ) {
			setStateBySite( ( previous ) => ( {
				...previous,
				[ siteId ]: {
					...( previous[ siteId ] ?? INITIAL_DEPLOY_STATE ),
					isDeploying: false,
					statusMessage: undefined,
					errorMessage: error instanceof Error ? error.message : __( 'The deploy failed.' ),
				},
			} ) );
			return false;
		}
	}, [] );

	const cancel = useCallback( async ( siteId: string ) => {
		await getIpcApi().cancelDeploy( siteId );
	}, [] );

	const saveTarget = useCallback(
		async ( siteId: string, target: Partial< DeployTarget > ): Promise< DeployTarget > => {
			return getIpcApi().saveDeployTarget( siteId, target );
		},
		[]
	);

	const clearResult = useCallback( ( siteId: string ) => {
		setStateBySite( ( previous ) => ( {
			...previous,
			[ siteId ]: {
				...( previous[ siteId ] ?? INITIAL_DEPLOY_STATE ),
				errorMessage: undefined,
				completedAt: undefined,
				warnings: [],
			},
		} ) );
	}, [] );

	return { getState, deploy, cancel, saveTarget, clearResult };
}
