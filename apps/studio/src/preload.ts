// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { IpcRendererEvent, contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import { IpcEvents } from 'src/ipc-utils';

function ipcRendererInvoke< T extends keyof IpcHandlers >(
	channel: T,
	...args: WithoutIpcEvent< Parameters< IpcHandlers[ T ] > >
) {
	return ipcRenderer.invoke( channel, ...args );
}

function ipcRendererSend< T extends keyof IpcHandlers >(
	channel: T,
	...args: WithoutIpcEvent< Parameters< IpcHandlers[ T ] > >
) {
	ipcRenderer.send( channel, ...args );
	return undefined;
}

const api: IpcApi = {
	deleteSite: ( id, deleteFiles ) => ipcRendererInvoke( 'deleteSite', id, deleteFiles ),
	copySite: ( sourceSiteId, newSiteId, siteName ) =>
		ipcRendererInvoke( 'copySite', sourceSiteId, newSiteId, siteName ),
	createSite: ( path, config ) => ipcRendererInvoke( 'createSite', path, config ),
	updateSite: ( updatedSite, wpVersion ) =>
		ipcRendererInvoke( 'updateSite', updatedSite, wpVersion ),
	exportSite: ( site, destinationPath, options ) =>
		ipcRendererInvoke( 'exportSite', site, destinationPath, options ),
	getSiteDetails: () => ipcRendererInvoke( 'getSiteDetails' ),
	reconcileSites: () => ipcRendererInvoke( 'reconcileSites' ),
	getXdebugEnabledSite: () => ipcRendererInvoke( 'getXdebugEnabledSite' ),
	openSiteURL: ( id, relativeURL = '', { autoLogin = true } = {} ) =>
		ipcRendererSend( 'openSiteURL', id, relativeURL, { autoLogin } ),
	openURL: ( url ) => ipcRendererSend( 'openURL', url ),
	showOpenFolderDialog: ( title, defaultDialogPath ) =>
		ipcRendererInvoke( 'showOpenFolderDialog', title, defaultDialogPath ),
	isCATrusted: () => ipcRenderer.invoke( 'isCATrusted' ),
	trustCertificate: () => ipcRenderer.invoke( 'trustCertificate' ),
	showSaveAsDialog: ( options ) => ipcRendererInvoke( 'showSaveAsDialog', options ),
	saveUserLocale: ( locale ) => ipcRendererInvoke( 'saveUserLocale', locale ),
	getUserLocale: () => ipcRendererInvoke( 'getUserLocale' ),
	getDefaultSiteDirectory: () => ipcRendererInvoke( 'getDefaultSiteDirectory' ),
	saveDefaultSiteDirectory: ( directory ) =>
		ipcRendererInvoke( 'saveDefaultSiteDirectory', directory ),
	showUserSettings: ( tabName ) => ipcRendererInvoke( 'showUserSettings', tabName ),
	startServer: ( id ) => ipcRendererInvoke( 'startServer', id ),
	stopServer: ( id ) => ipcRendererInvoke( 'stopServer', id ),
	stopAllServers: () => ipcRendererInvoke( 'stopAllServers' ),
	copyText: ( text ) => ipcRendererInvoke( 'copyText', text ),
	getAppGlobals: () => ipcRendererInvoke( 'getAppGlobals' ),
	getWpVersion: ( id ) => ipcRendererInvoke( 'getWpVersion', id ),
	getSiteStorageUsage: ( id, requestId ) =>
		ipcRendererInvoke( 'getSiteStorageUsage', id, requestId ),
	cancelSiteStorageUsage: ( requestId ) => ipcRendererInvoke( 'cancelSiteStorageUsage', requestId ),
	getIsMultisite: ( id ) => ipcRendererInvoke( 'getIsMultisite', id ),
	generateProposedSitePath: ( siteName ) =>
		ipcRendererInvoke( 'generateProposedSitePath', siteName ),
	generateSiteNameFromList: ( usedSites ) =>
		ipcRendererInvoke( 'generateSiteNameFromList', usedSites ),
	generateNumberedNameFromList: ( baseName, usedSites ) =>
		ipcRendererInvoke( 'generateNumberedNameFromList', baseName, usedSites ),
	openLocalPath: ( path ) => ipcRendererSend( 'openLocalPath', path ),
	openStudioLogs: () => ipcRendererSend( 'openStudioLogs' ),
	showItemInFolder: ( path ) => ipcRendererSend( 'showItemInFolder', path ),
	loadThemeDetails: ( id, emitLoadingEvent = true ) =>
		ipcRendererInvoke( 'loadThemeDetails', id, emitLoadingEvent ),
	loadSiteIcon: ( id ) => ipcRendererInvoke( 'loadSiteIcon', id ),
	getThumbnailData: ( id ) => ipcRendererInvoke( 'getThumbnailData', id ),
	getInstalledAppsAndTerminals: () => ipcRendererInvoke( 'getInstalledAppsAndTerminals' ),
	importSite: ( siteId, importArchivePath, options ) =>
		ipcRendererInvoke( 'importSite', siteId, importArchivePath, options ),
	executeWPCLiInline: ( options ) => ipcRendererInvoke( 'executeWPCLiInline', options ),
	openAppAtPath: ( editorKey, filePath, otherFiles?: string[] ) =>
		ipcRendererInvoke( 'openAppAtPath', editorKey, filePath, otherFiles ),
	openTerminalAtPath: ( targetPath ) => ipcRendererInvoke( 'openTerminalAtPath', targetPath ),
	showMessageBox: ( options ) => ipcRendererInvoke( 'showMessageBox', options ),
	showErrorMessageBox: ( options ) => ipcRendererSend( 'showErrorMessageBox', options ),
	showNotification: ( options ) => ipcRendererSend( 'showNotification', options ),
	logRendererMessage: ( level, ...args ) => ipcRendererSend( 'logRendererMessage', level, ...args ),
	setupAppMenu: ( config ) => ipcRendererInvoke( 'setupAppMenu', config ),
	popupAppMenu: ( position ) => ipcRendererSend( 'popupAppMenu', position ),
	openCertificate: () => ipcRendererSend( 'openCertificate' ),
	promptWindowsSpeedUpSites: ( ...args ) =>
		ipcRendererInvoke( 'promptWindowsSpeedUpSites', ...args ),
	setDefaultLocaleData: ( locale ) => ipcRendererInvoke( 'setDefaultLocaleData', locale ),
	resetDefaultLocaleData: () => ipcRendererInvoke( 'resetDefaultLocaleData' ),
	toggleMinWindowWidth: ( isSidebarVisible, currentSidebarWidth? ) =>
		ipcRendererInvoke( 'toggleMinWindowWidth', isSidebarVisible, currentSidebarWidth ),
	ensureMinWindowWidth: ( minimumWidth ) =>
		ipcRendererInvoke( 'ensureMinWindowWidth', minimumWidth ),
	getAbsolutePathFromSite: ( siteId, relativePath ) =>
		ipcRendererInvoke( 'getAbsolutePathFromSite', siteId, relativePath ),
	openFileInIDE: ( relativePath, siteId ) =>
		ipcRendererSend( 'openFileInIDE', relativePath, siteId ),
	isImportExportSupported: ( siteId ) => ipcRendererInvoke( 'isImportExportSupported', siteId ),
	getDirectorySize: ( id, subdir ) => ipcRendererInvoke( 'getDirectorySize', id, subdir ),
	getFileSize: ( id, filePath ) => ipcRendererInvoke( 'getFileSize', id, filePath ),
	getPathForFile: ( file ) => webUtils.getPathForFile( file ),
	getAppZoomFactor: () => webFrame.getZoomFactor(),
	isFullscreen: () => ipcRendererInvoke( 'isFullscreen' ),
	getAllCustomDomains: () => ipcRendererInvoke( 'getAllCustomDomains' ),
	saveUserTerminal: ( preferredTerminal ) =>
		ipcRendererInvoke( 'saveUserTerminal', preferredTerminal ),
	getUserTerminal: () => ipcRendererInvoke( 'getUserTerminal' ),
	previewColorScheme: ( colorScheme ) => ipcRendererInvoke( 'previewColorScheme', colorScheme ),
	saveColorScheme: ( colorScheme ) => ipcRendererInvoke( 'saveColorScheme', colorScheme ),
	getColorScheme: () => ipcRendererInvoke( 'getColorScheme' ),
	saveQuitSitesBehavior: ( quitSitesBehavior ) =>
		ipcRendererInvoke( 'saveQuitSitesBehavior', quitSitesBehavior ),
	getQuitSitesBehavior: () => ipcRendererInvoke( 'getQuitSitesBehavior' ),
	getUserEditor: () => ipcRendererInvoke( 'getUserEditor' ),
	saveUserEditor: ( editor ) => ipcRendererInvoke( 'saveUserEditor', editor ),
	comparePaths: ( path1, path2 ) => ipcRendererInvoke( 'comparePaths', path1, path2 ),
	validateBlueprint: ( blueprintJson ) => ipcRendererInvoke( 'validateBlueprint', blueprintJson ),
	readBlueprintFile: ( filePath ) => ipcRendererInvoke( 'readBlueprintFile', filePath ),
	extractBlueprintBundle: ( zipFilePath ) =>
		ipcRendererInvoke( 'extractBlueprintBundle', zipFilePath ),
	cleanupBlueprintTempDir: ( tempDir ) => ipcRendererInvoke( 'cleanupBlueprintTempDir', tempDir ),
	showSiteContextMenu: ( context ) => ipcRendererSend( 'showSiteContextMenu', context ),
	showTextContextMenu: ( context ) => ipcRendererInvoke( 'showTextContextMenu', context ),
	setWindowControlVisibility: ( visible ) =>
		ipcRendererInvoke( 'setWindowControlVisibility', visible ),
	setTitleBarBackdropEffect: ( enabled ) =>
		ipcRendererInvoke( 'setTitleBarBackdropEffect', enabled ),
	updateSitesSortOrder: ( updates ) => ipcRendererInvoke( 'updateSitesSortOrder', updates ),
	isStudioCliInstalled: () => ipcRendererInvoke( 'isStudioCliInstalled' ),
	isStudioCliExternallyManaged: () => ipcRendererInvoke( 'isStudioCliExternallyManaged' ),
	installStudioCli: () => ipcRendererInvoke( 'installStudioCli' ),
	uninstallStudioCli: () => ipcRendererInvoke( 'uninstallStudioCli' ),
	getDeployTarget: ( siteId ) => ipcRendererInvoke( 'getDeployTarget', siteId ),
	saveDeployTarget: ( siteId, target ) => ipcRendererInvoke( 'saveDeployTarget', siteId, target ),
	deploySite: ( siteId, request ) => ipcRendererInvoke( 'deploySite', siteId, request ),
	pullSite: ( siteId, request ) => ipcRendererInvoke( 'pullSite', siteId, request ),
	cancelDeploy: ( siteId ) => ipcRendererInvoke( 'cancelDeploy', siteId ),
	getLicenses: () => ipcRendererInvoke( 'getLicenses' ),
	saveLicense: ( slug, label, key ) => ipcRendererInvoke( 'saveLicense', slug, label, key ),
	deleteLicense: ( slug ) => ipcRendererInvoke( 'deleteLicense', slug ),
};

contextBridge.exposeInMainWorld( 'ipcApi', api );

const subscribe = < T extends keyof IpcEvents >(
	channel: T,
	listener: ( event: IpcRendererEvent, ...args: IpcEvents[ T ] ) => void
) => {
	function wrappedListener( event: IpcRendererEvent, ...args: any[] ) {
		listener( event, ...( args as IpcEvents[ T ] ) );
	}

	ipcRenderer.on( channel, wrappedListener );

	return () => {
		ipcRenderer.off( channel, wrappedListener );
	};
};

declare global {
	interface Window {
		ipcListener: {
			subscribe: typeof subscribe;
		};
	}
}

contextBridge.exposeInMainWorld( 'ipcListener', { subscribe } );
