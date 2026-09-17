import React, { createContext, useContext, ReactNode, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { FEATURE_FLAGS } from 'src/lib/feature-flags';
import { getIpcApi } from 'src/lib/get-ipc-api';

type FeatureFlagsContextType = FeatureFlags;

function createDefaultFeatureFlags(): FeatureFlags {
	const flags = {} as FeatureFlags;
	for ( const [ key, def ] of Object.entries( FEATURE_FLAGS ) ) {
		const flagKey = key as keyof FeatureFlags;
		const flagDef = def as { default: boolean };
		Object.defineProperty( flags, flagKey, { value: flagDef.default } );
	}
	return flags;
}

const defaultFeatureFlags = createDefaultFeatureFlags();

const FeatureFlagsContext = createContext< FeatureFlagsContextType >( defaultFeatureFlags );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( () => {
		return {
			...defaultFeatureFlags,
			...window.appGlobals,
		};
	} );

	useIpcListener( 'refresh-app-globals', async () => {
		window.appGlobals = await getIpcApi().getAppGlobals();
		setFeatureFlags( {
			...defaultFeatureFlags,
			...window.appGlobals,
		} );
	} );

	return (
		<FeatureFlagsContext.Provider value={ featureFlags }>{ children }</FeatureFlagsContext.Provider>
	);
};

export const useFeatureFlags = (): FeatureFlagsContextType => {
	const context = useContext( FeatureFlagsContext );

	if ( ! context ) {
		throw new Error( 'useFeatureFlags must be used within an FeatureFlagsProvider' );
	}

	return context;
};
