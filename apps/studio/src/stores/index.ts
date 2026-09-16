import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector } from 'react-redux';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import i18nReducer from 'src/stores/i18n-slice';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import uiReducer from 'src/stores/ui-slice';
import { wordpressVersionsApi } from './wordpress-versions-api';
import type { SupportedLocale } from '@studio/common/lib/locale';

export type RootState = {
	installedAppsApi: ReturnType< typeof installedAppsApi.reducer >;
	wordpressVersionsApi: ReturnType< typeof wordpressVersionsApi.reducer >;
	certificateTrustApi: ReturnType< typeof certificateTrustApi.reducer >;
	i18n: ReturnType< typeof i18nReducer >;
	ui: ReturnType< typeof uiReducer >;
};

export const rootReducer = combineReducers( {
	installedAppsApi: installedAppsApi.reducer,
	wordpressVersionsApi: wordpressVersionsApi.reducer,
	certificateTrustApi: certificateTrustApi.reducer,
	i18n: i18nReducer,
	ui: uiReducer,
} );

export const store = configureStore( {
	reducer: rootReducer,
	middleware: ( getDefaultMiddleware ) =>
		getDefaultMiddleware()
			.concat( installedAppsApi.middleware )
			.concat( wordpressVersionsApi.middleware )
			.concat( certificateTrustApi.middleware ),
} );

// Enable the refetchOnFocus behavior
setupListeners( store.dispatch );

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch< AppDispatch >();
export const useRootSelector = < T >( selector: ( state: RootState ) => T ) =>
	useSelector( selector );

export const useI18nLocale = (): SupportedLocale =>
	useRootSelector( ( state: RootState ) => state.i18n.locale );
