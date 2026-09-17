import {
	app,
	BrowserWindow,
	ipcMain,
	session,
	type IpcMainInvokeEvent,
	globalShortcut,
	Menu,
	dialog,
} from 'electron';
import { runMigrations } from '@studio/common/lib/migration';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __, _n } from '@wordpress/i18n';
import {
	installExtension,
	REACT_DEVELOPER_TOOLS,
	REDUX_DEVTOOLS,
} from 'electron-devtools-installer';
import { IPC_VOID_HANDLERS } from 'src/constants';
import * as ipcHandlers from 'src/ipc-handlers';
import { markAppQuitting } from 'src/ipc-utils';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { setupLogging } from 'src/logging';
import { createMainWindow, getCurrentRendererUrl, getMainWindow } from 'src/main-window';
import { migrations } from 'src/migrations';
import {
	startCliEventsSubscriber,
	stopCliEventsSubscriber,
} from 'src/modules/cli/lib/cli-events-subscriber';
import { autoInstallLinuxCliIfNeeded } from 'src/modules/cli/lib/linux-installation-manager';
import { autoInstallMacOSCliIfNeeded } from 'src/modules/cli/lib/macos-installation-manager';
import { autoInstallWindowsCliIfNeeded } from 'src/modules/cli/lib/windows-installation-manager';
import {
	getRunningSiteCount,
	persistAutoStartForRunningSites,
	SiteServer,
	stopAllServers,
} from 'src/site-server';
import { loadUserData, updateAppdata, type QuitSitesBehavior } from 'src/storage/user-data';
// eslint-disable-next-line import-x/order
import packageJson from '../package.json';

const STOP_ALL_SERVERS_ON_QUIT_TIMEOUT_MS = process.env.E2E ? 20_000 : 6_000;

// Helper function to get the actual URL for validation
function getRendererUrl(): string {
	return getCurrentRendererUrl();
}

suppressPunycodeWarning();

const isInInstaller = require( 'electron-squirrel-startup' );

// Ensure we're the only instance of the app running
const gotTheLock = app.requestSingleInstanceLock();

let finishedInitialization = false;

if ( gotTheLock && ! isInInstaller ) {
	void appBoot();
} else if ( ! gotTheLock ) {
	app.quit();
}

// This is a workaround to ensure that the extension background workers are started
// If you are updating Electron, confirm if this is still needed
// https://github.com/electron/electron/issues/41613
function launchExtensionBackgroundWorkers( appSession = session.defaultSession ) {
	const extensionApi = ( appSession.extensions as Electron.Extensions | undefined ) || appSession;
	return Promise.all(
		extensionApi.getAllExtensions().map( async ( extension ) => {
			const manifest = extension.manifest;
			if ( manifest.manifest_version === 3 && manifest?.background?.service_worker ) {
				await appSession.serviceWorkers.startWorkerForScope( extension.url );
			}
		} )
	);
}

async function appBoot() {
	app.setName( packageJson.productName );

	Menu.setApplicationMenu( null );

	setupSecondInstanceHandler();

	setupLogging();

	// Forces all renderers to be sandboxed. IPC is the only way render processes will
	// be able to perform privileged operations.
	app.enableSandbox();

	// Prevent navigation to anywhere other than known locations.
	app.on( 'web-contents-created', ( _event, contents ) => {
		contents.on( 'will-navigate', ( event, navigationUrl ) => {
			const { origin } = new URL( navigationUrl );
			const allowedOrigins = [ new URL( getRendererUrl() ).origin ];
			if ( ! allowedOrigins.includes( origin ) ) {
				event.preventDefault();
			}
		} );
		contents.setWindowOpenHandler( () => {
			return { action: 'deny' };
		} );
	} );

	function validateIpcSender( event: IpcMainInvokeEvent ) {
		if ( ! event.senderFrame ) {
			throw new Error(
				'Failed IPC sender validation check: the frame has either navigated or been destroyed'
			);
		}

		if ( new URL( event.senderFrame.url ).origin === new URL( getRendererUrl() ).origin ) {
			return true;
		}

		throw new Error( 'Failed IPC sender validation check: ' + event.senderFrame.url );
	}

	function setupIpc() {
		const ipcHandlerEntries = Object.entries( ipcHandlers ) as [
			keyof typeof ipcHandlers,
			( ...args: unknown[] ) => unknown,
		][];

		for ( const [ key, handler ] of ipcHandlerEntries ) {
			if ( IPC_VOID_HANDLERS.find( ( handler ) => handler === key ) ) {
				ipcMain.on( key, function ( event, ...args: unknown[] ) {
					try {
						validateIpcSender( event );
						handler( event, ...args );
					} catch ( error ) {
						console.error( error );
						throw error;
					}
				} );
			} else {
				ipcMain.handle( key, function ( event, ...args: unknown[] ) {
					try {
						validateIpcSender( event );
						return handler( event, ...args );
					} catch ( error ) {
						console.error( error );
						throw error;
					}
				} );
			}
		}
	}

	function setupSecondInstanceHandler() {
		// A second launch (e.g. double-clicking the app icon again) focuses the existing window.
		app.on( 'second-instance', async ( _event, argv ) => {
			if ( ! finishedInitialization ) {
				return;
			}

			const mainWindow = await getMainWindow();
			// CLI commands are likely invoked from other apps, so we need to avoid changing app focus.
			const isCLI = argv?.find( ( arg ) => arg.startsWith( '--cli=' ) );
			if ( ! isCLI ) {
				if ( mainWindow.isMinimized() ) mainWindow.restore();
				mainWindow.focus();
			}
		} );
	}

	app.on( 'ready', async () => {
		const locale = await getUserLocaleWithFallback();
		if ( process.env.NODE_ENV === 'development' ) {
			await installExtension( REACT_DEVELOPER_TOOLS );
			await installExtension( REDUX_DEVTOOLS );
			await launchExtensionBackgroundWorkers();
		}

		console.log( `App version: ${ app.getVersion() }` );
		console.log( `Environment: ${ process.env.NODE_ENV ?? 'undefined' }` );
		console.log( `Built from commit: ${ COMMIT_HASH ?? 'undefined' }` );
		console.log( `Local timezone: ${ Intl.DateTimeFormat().resolvedOptions().timeZone }` );
		console.log( `App locale: ${ app.getLocale() }` );
		console.log( `System locale: ${ app.getSystemLocale() }` );
		console.log( `Used language: ${ locale }` );

		// By default Electron automatically approves all permissions requests (e.g. notifications, webcam)
		// We'll opt-in to permissions we specifically need instead.
		session.defaultSession.setPermissionRequestHandler( ( webContents, permission, callback ) => {
			// Reject all permission requests
			callback( false );
		} );

		session.defaultSession.webRequest.onHeadersReceived( ( details, callback ) => {
			// Only set a custom CSP header the main window UI. For other pages (like login) we should
			// use the CSP provided by the server, which is more likely to be up-to-date and complete.
			if ( details.url !== getRendererUrl() ) {
				callback( details );
				return;
			}

			const basePolicies = [
				"default-src 'self'", // Allow resources from these domains
				"script-src-attr 'none'",
				"img-src 'self' data:",
				"style-src 'self' 'unsafe-inline'", // unsafe-inline used by tailwindcss in development, and also in production after the app rename
				process.env.NODE_ENV === 'development'
					? "script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' data: http://localhost:*"
					: "script-src 'self' 'wasm-unsafe-eval'", // allow WebAssembly to compile and instantiate
			];
			const prodPolicies = [ "connect-src 'self' https://api.wordpress.org" ];
			const devPolicies = [
				// react-devtools uses localhost
				"connect-src 'self' https://api.wordpress.org ws://localhost:*",
			];
			const policies = [
				...basePolicies,
				...( process.env.NODE_ENV === 'development' ? devPolicies : prodPolicies ),
			];

			callback( {
				...details,
				responseHeaders: {
					...details.responseHeaders,
					'Content-Security-Policy': [ policies.filter( Boolean ).join( '; ' ) ],
				},
			} );
		} );

		setupIpc();

		await runMigrations( migrations ).catch( ( error ) => {
			console.error( 'Failed to run migrations:', error );
		} );

		// Fetch data from CLI and subscribe to CLI events before starting the user data
		// watcher. The watcher can trigger getMainWindow() which creates the window early,
		// so sites must be loaded first.
		await SiteServer.fetchAll();
		await startCliEventsSubscriber();

		await createMainWindow();

		await autoInstallWindowsCliIfNeeded();
		await autoInstallMacOSCliIfNeeded();
		await autoInstallLinuxCliIfNeeded();

		finishedInitialization = true;
	} );

	// Quit when all windows are closed, except on macOS. There, it's common
	// for applications and their menu bar to stay active until the user quits
	// explicitly with Cmd + Q.
	app.on( 'window-all-closed', () => {
		if ( process.platform !== 'darwin' ) {
			app.quit();
		}
	} );

	/**
	 * We want to stop all running sites (including the process daemon) in any of these cases:
	 * - There are no running sites (in which case we kill just the daemon)
	 * - There are running sites, and the user has confirmed they want to stop them upon closing the app
	 */
	let shouldStopSitesOnQuit = true;
	let clearAutoStartOnQuit = false;
	let isQuittingConfirmed = false;

	const applyQuitSitesBehavior = ( behavior: QuitSitesBehavior ) => {
		shouldStopSitesOnQuit = behavior !== 'leave-running';
		clearAutoStartOnQuit = behavior === 'stop';
	};

	app.on( 'before-quit', ( event ) => {
		if ( isQuittingConfirmed ) {
			return;
		}

		const runningSiteCount = getRunningSiteCount();
		if ( runningSiteCount > 0 ) {
			event.preventDefault();

			void ( async () => {
				const userData = await loadUserData();

				if ( userData.quitSitesBehavior !== undefined ) {
					applyQuitSitesBehavior( userData.quitSitesBehavior );
					isQuittingConfirmed = true;
					app.quit();
					return;
				}

				if ( process.env.E2E ) {
					isQuittingConfirmed = true;
					app.quit();
					return;
				}

				const STOP_SITES_BUTTON_INDEX = 0;
				const KEEP_RUNNING_BUTTON_INDEX = 1;
				const CANCEL_BUTTON_INDEX = 2;

				const { response, checkboxChecked } = await dialog.showMessageBox( {
					type: 'question',
					message: _n( 'Keep the site running?', 'Keep the sites running?', runningSiteCount ),
					detail: _n(
						'Your site can stay available in the background after Studio quits.',
						'Your sites can stay available in the background after Studio quits.',
						runningSiteCount
					),
					buttons: [
						_n( 'Stop site', 'Stop sites', runningSiteCount ),
						_n( 'Keep site running', 'Keep sites running', runningSiteCount ),
						__( 'Cancel' ),
					],
					checkboxLabel: __( 'Remember my choice' ),
					cancelId: CANCEL_BUTTON_INDEX,
					defaultId: STOP_SITES_BUTTON_INDEX,
				} );

				if ( response === CANCEL_BUTTON_INDEX ) {
					return;
				}

				const behavior: QuitSitesBehavior =
					response === KEEP_RUNNING_BUTTON_INDEX ? 'leave-running' : 'stop';

				if ( checkboxChecked ) {
					await updateAppdata( { quitSitesBehavior: behavior } );
				}

				applyQuitSitesBehavior( behavior );
				isQuittingConfirmed = true;
				app.quit();
			} )();

			return;
		}
	} );

	app.on( 'will-quit', ( event ) => {
		markAppQuitting();
		globalShortcut.unregisterAll();
		stopCliEventsSubscriber();

		if ( shouldStopSitesOnQuit ) {
			event.preventDefault();
			void ( async () => {
				try {
					// The events subscriber is already stopped, so the "Stop" choice clears autoStart here.
					if ( clearAutoStartOnQuit ) {
						await persistAutoStartForRunningSites( false );
					}
					await stopAllServers( STOP_ALL_SERVERS_ON_QUIT_TIMEOUT_MS );
				} finally {
					app.exit();
				}
			} )();
		}
	} );

	app.on( 'activate', () => {
		if ( ! finishedInitialization ) {
			return;
		}

		if ( BrowserWindow.getAllWindows().length === 0 ) {
			// On OS X it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			void createMainWindow();
		}
	} );
}
