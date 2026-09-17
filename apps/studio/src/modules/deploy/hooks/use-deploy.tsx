import {
	INITIAL_DEPLOY_STATE,
	type DeployRequest,
	type DeployState,
	type TransferKind,
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
					kind: progress.kind,
					isDeploying: true,
					statusMessage: progress.message,
				},
			};
		} );
	} );

	const run = useCallback(
		async ( kind: TransferKind, siteId: string, request: DeployRequest = {} ) => {
			setStateBySite( ( previous ) => ( {
				...previous,
				[ siteId ]: {
					kind,
					isDeploying: true,
					statusMessage: kind === 'pull' ? __( 'Starting pull…' ) : __( 'Starting deploy…' ),
					warnings: [],
				},
			} ) );

			try {
				if ( kind === 'pull' ) {
					await getIpcApi().pullSite( siteId, request );
				} else {
					await getIpcApi().deploySite( siteId, request );
				}
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
				const fallback = kind === 'pull' ? __( 'The pull failed.' ) : __( 'The deploy failed.' );
				setStateBySite( ( previous ) => ( {
					...previous,
					[ siteId ]: {
						...( previous[ siteId ] ?? INITIAL_DEPLOY_STATE ),
						isDeploying: false,
						statusMessage: undefined,
						errorMessage: error instanceof Error ? error.message : fallback,
					},
				} ) );
				return false;
			}
		},
		[]
	);

	const deploy = useCallback(
		( siteId: string, request: DeployRequest = {} ) => run( 'deploy', siteId, request ),
		[ run ]
	);

	const pull = useCallback(
		( siteId: string, request: DeployRequest = {} ) => run( 'pull', siteId, request ),
		[ run ]
	);

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

	return { getState, deploy, pull, cancel, saveTarget, clearResult };
}
