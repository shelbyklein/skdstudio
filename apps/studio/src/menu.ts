import {
	Menu,
	type MenuItemConstructorOptions,
	app,
	BrowserWindow,
	MenuItem,
	shell,
	type WebContents,
} from 'electron';
import {
	getAppConfigPath,
	getCliConfigPath,
	getSharedConfigPath,
} from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { openAboutWindow } from 'src/about-menu/open-about-menu';
import { BUG_REPORT_URL, REPOSITORY_URL } from 'src/constants';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { applyAppZoomCommand } from 'src/lib/app-zoom';
import {
	FEATURE_FLAGS,
	FeatureFlagDefinition,
	getFeatureFlagFromEnv,
	setFeatureFlagInEnv,
} from 'src/lib/feature-flags';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { getLogsFilePath } from 'src/logging';
import { getMainWindow } from 'src/main-window';

// Runs against the app window's own contents rather than whatever has focus.
async function withAppWebContents( run: ( contents: WebContents ) => void ) {
	const window = await getMainWindow();
	if ( window && ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
		run( window.webContents );
	}
}

export async function setupMenu( config: { isAddSiteVisible?: boolean } = {} ) {
	const mainWindow = await getMainWindow();
	if ( ! mainWindow && process.platform !== 'darwin' ) {
		Menu.setApplicationMenu( null );
		return;
	}
	const menu = await getAppMenu( mainWindow, config );
	if ( process.platform === 'darwin' ) {
		Menu.setApplicationMenu( menu );
		return;
	}
	// Make menu accessible in development for non-macOS platforms
	if ( process.env.NODE_ENV === 'development' ) {
		mainWindow?.setMenu( menu );
		return;
	}
	Menu.setApplicationMenu( null );
}

export function removeMenu() {
	Menu.setApplicationMenu( null );
}

export async function popupMenu( position?: { x: number; y: number } ) {
	const window = await getMainWindow();
	const menu = await getAppMenu( window );
	menu.popup( { window: window ?? undefined, ...position } );
}

export function buildViewMenuItems( {
	isDevelopment,
	isAlwaysOnTop,
	devTools,
	onToggleSidebar,
	onResetZoom,
	onZoomIn,
	onZoomOut,
}: {
	isDevelopment: boolean;
	isAlwaysOnTop?: boolean;
	devTools: MenuItemConstructorOptions[];
	onToggleSidebar: () => void;
	onResetZoom: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
} ): MenuItemConstructorOptions[] {
	return [
		{
			label: __( 'Toggle Sidebar' ),
			accelerator: 'CommandOrControl+B',
			click: onToggleSidebar,
		},
		...( isDevelopment ? devTools : [] ),
		{
			label: __( 'Actual Size' ),
			accelerator: 'CommandOrControl+0',
			click: onResetZoom,
		},
		{
			label: __( 'Zoom In' ),
			accelerator: 'CommandOrControl+Plus',
			click: onZoomIn,
		},
		{
			label: __( 'Zoom Out' ),
			accelerator: 'CommandOrControl+-',
			click: onZoomOut,
		},
		{ type: 'separator' },
		{
			label: __( 'Toggle Fullscreen' ),
			role: 'togglefullscreen',
		},
		{ type: 'separator' },
		{
			label: __( 'Float on Top of All Other Windows' ),
			type: 'checkbox',
			checked: isAlwaysOnTop,
			click: ( _menuItem, browserWindow ) => {
				if ( browserWindow ) {
					browserWindow.setAlwaysOnTop( ! browserWindow.isAlwaysOnTop(), 'floating' );
				}
			},
		},
	];
}

async function getAppMenu(
	mainWindow: BrowserWindow | null,
	{ isAddSiteVisible = false }: { isAddSiteVisible?: boolean } = {}
) {
	const crashTestMenuItems: MenuItemConstructorOptions[] = [
		{
			label: __( 'Test Hard Crash (dev only)' ),
			click: () => {
				process.crash();
			},
		},
		{
			label: __( 'Test Render Failure (dev only)' ),
			click: async () => {
				void sendIpcEventToRenderer( 'test-render-failure' );
			},
		},
	];

	const devTools: MenuItemConstructorOptions[] = [
		{
			label: __( 'Reload App' ),
			accelerator: 'CommandOrControl+R',
			click: () => void withAppWebContents( ( contents ) => contents.reload() ),
		},
		{
			label: __( 'Force Reload App' ),
			accelerator: 'CommandOrControl+Shift+R',
			click: () => void withAppWebContents( ( contents ) => contents.reloadIgnoringCache() ),
		},
		{
			label: __( 'Toggle DevTools' ),
			accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Control+Shift+I',
			click: () => void withAppWebContents( ( contents ) => contents.toggleDevTools() ),
		},
		{ type: 'separator' },
	];

	const featureFlagsMenu: MenuItemConstructorOptions[] = Object.entries< FeatureFlagDefinition >(
		FEATURE_FLAGS
	).map( ( [ flag, definition ] ) => ( {
		label: definition.label,
		type: 'checkbox' as const,
		checked: getFeatureFlagFromEnv( flag as keyof FeatureFlags ),
		click: ( menuItem: MenuItem ) => {
			setFeatureFlagInEnv( flag as keyof FeatureFlags, menuItem.checked );
			void sendIpcEventToRenderer( 'refresh-app-globals' );
		},
	} ) );

	return Menu.buildFromTemplate( [
		{
			label: app.name, // macOS ignores this name and uses the name from the .plist
			role: 'appMenu',
			submenu: [
				{
					label: __( 'About Studio' ),
					click: openAboutWindow,
				},
				{ type: 'separator' },
				{
					label: __( 'Settings…' ),
					accelerator: 'CommandOrControl+,',
					click: async () => {
						void sendIpcEventToRenderer( 'user-settings', { tabName: 'general' } );
					},
				},
				{ type: 'separator' },
				...( process.platform === 'win32'
					? []
					: [ { label: __( 'Services' ), role: 'services' } as MenuItemConstructorOptions ] ),
				{ type: 'separator' },
				...( process.platform === 'win32'
					? []
					: [ { label: __( 'Hide' ), role: 'hide' } as MenuItemConstructorOptions ] ),
				{ type: 'separator' },
				...( process.env.NODE_ENV === 'development' ? crashTestMenuItems : [] ),
				...( process.env.NODE_ENV === 'development'
					? [
							{
								label: __( 'Open Config Files (dev only)' ),
								submenu: [
									{
										label: __( 'App Config (app.json)' ),
										click: async () => {
											const configPath = getAppConfigPath();
											const err = await shell.openPath( configPath );
											if ( err ) {
												console.error( `Error opening config file: ${ configPath } ${ err }` );
											}
										},
									},
									{
										label: __( 'Shared Config (shared.json)' ),
										click: async () => {
											const configPath = getSharedConfigPath();
											const err = await shell.openPath( configPath );
											if ( err ) {
												console.error( `Error opening config file: ${ configPath } ${ err }` );
											}
										},
									},
									{
										label: __( 'CLI Config (cli.json)' ),
										click: async () => {
											const configPath = getCliConfigPath();
											const err = await shell.openPath( configPath );
											if ( err ) {
												console.error( `Error opening config file: ${ configPath } ${ err }` );
											}
										},
									},
								],
							},
							{
								label: __( 'Feature Flags' ),
								submenu: featureFlagsMenu,
								enabled: featureFlagsMenu.length > 0,
							},
					  ]
					: [] ),
				{ type: 'separator' },
				{ label: __( 'Quit' ), role: 'quit' },
			],
		},
		{
			label: __( 'File' ),
			role: 'fileMenu',
			submenu: [
				{
					label: __( 'Add Site…' ),
					accelerator: 'CommandOrControl+N',
					click: async () => {
						void sendIpcEventToRenderer( 'add-site' );
					},
					enabled: ! isAddSiteVisible,
				},
				...( process.platform === 'win32'
					? []
					: [
							{
								label: __( 'Close Window' ),
								accelerator: 'CommandOrControl+W',
								click: ( _menuItem, browserWindow ) => {
									browserWindow?.close();
								},
								enabled: !! mainWindow && ! mainWindow.isDestroyed(),
							} as MenuItemConstructorOptions,
					  ] ),
			],
		},
		{
			label: __( 'Edit' ),
			role: 'editMenu',
			submenu: [
				{
					label: __( 'Undo' ),
					role: 'undo',
				},
				{
					label: __( 'Redo' ),
					role: 'redo',
				},
				{ type: 'separator' },
				{ label: __( 'Cut' ), role: 'cut' },
				{ label: __( 'Copy' ), role: 'copy' },
				{ label: __( 'Paste' ), role: 'paste' },
				{
					label: __( 'Paste and Match Style' ),
					role: 'pasteAndMatchStyle',
				},
				{ label: __( 'Delete' ), role: 'delete' },
				{ label: __( 'Select All' ), role: 'selectAll' },
				{ type: 'separator' },
				{
					label: __( 'Speech' ),
					submenu: [
						{ label: __( 'Start Speaking' ), role: 'startSpeaking' },
						{ label: __( 'Stop Speaking' ), role: 'stopSpeaking' },
					],
				},
			],
		},
		{
			label: __( 'View' ),
			role: 'viewMenu',
			submenu: buildViewMenuItems( {
				isDevelopment: process.env.NODE_ENV === 'development',
				isAlwaysOnTop: mainWindow?.isAlwaysOnTop(),
				devTools,
				onToggleSidebar: () => {
					void sendIpcEventToRenderer( 'toggle-sidebar' );
				},
				onResetZoom: () => {
					void withAppWebContents( ( contents ) => applyAppZoomCommand( contents, 'reset' ) );
				},
				onZoomIn: () => {
					void withAppWebContents( ( contents ) => applyAppZoomCommand( contents, 'in' ) );
				},
				onZoomOut: () => {
					void withAppWebContents( ( contents ) => applyAppZoomCommand( contents, 'out' ) );
				},
			} ),
		},
		...( process.platform === 'win32'
			? []
			: [
					{
						label: __( 'Window' ),
						role: 'windowMenu',
						// We can't remove all of the items which aren't relevant to us (anything for
						// managing multiple window instances), but this seems to remove as many of
						// them as we can.
						submenu: [
							{ label: __( 'Minimize' ), role: 'minimize' },
							{ label: __( 'Zoom' ), role: 'zoom' },
						],
					} as MenuItemConstructorOptions,
			  ] ),
		{
			label: __( 'Help' ),
			role: 'help',
			submenu: [
				{
					label: __( 'WordPress Studio Help' ),
					click: async () => {
						const locale = await getUserLocaleWithFallback();
						void shellOpenExternalWrapper( getLocalizedLink( locale, 'docsStudio' ) );
					},
				},
				{
					label: __( 'Source Code' ),
					click: () => {
						void shellOpenExternalWrapper( REPOSITORY_URL );
					},
				},
				{ type: 'separator' },
				...( process.platform === 'win32'
					? [
							{
								label: __( 'How can I make WordPress Studio faster?' ),
								click: () => {
									void promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );
								},
							},
					  ]
					: [] ),
				{
					label: __( 'Open Application Logs' ),
					click: async () => {
						const logFilePath = getLogsFilePath();
						const err = await shell.openPath( logFilePath );
						if ( err ) {
							console.error( `Error opening logs file: ${ logFilePath } ${ err }` );
						}
					},
				},
				{ type: 'separator' },
				{
					label: __( 'Report an Issue' ),
					click: () => {
						void shellOpenExternalWrapper( BUG_REPORT_URL );
					},
				},
			],
		},
	] );
}
