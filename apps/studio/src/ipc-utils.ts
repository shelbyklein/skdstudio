import { BrowserWindow } from 'electron';
import { SiteEvent } from '@studio/common/lib/cli-events';
import { DeployProgress, TransferKind } from '@studio/common/lib/deploy-events';
import { ExportIpcEvent, ImportEventTuple } from '@studio/common/lib/import-export-events';
import { getExistingMainWindow } from 'src/main-window';

export interface IpcEvents {
	'add-site': [ void ];
	'on-deploy': [ { siteId: string; kind: TransferKind } & Omit< DeployProgress, 'action' > ];
	'on-export': [ ExportIpcEvent[ 'event' ], string ];
	'on-import': [ ImportEventTuple, string ];
	'on-site-create-progress': [ { siteId: string; message: string } ];
	'site-context-menu-action': [ { action: string; siteId: string } ];
	'site-event': [ SiteEvent ];
	'test-render-failure': [ void ];
	'toggle-sidebar': [ void ];
	'theme-details-loading': [ { id: string } ];
	'theme-details-loaded': [ { id: string; details: StartedSiteDetails[ 'themeDetails' ] } ];
	'thumbnail-loading': [ { id: string } ];
	'thumbnail-loaded': [ { id: string; imageData: string | null } ];
	'thumbnail-load-error': [ { id: string } ];
	'user-settings': [ { tabName?: string } ];
	'window-fullscreen-change': [ boolean ];
	'user-preference-changed': [ void ];
	'refresh-app-globals': [ void ];
}

let isAppQuitting = false;

export function markAppQuitting() {
	isAppQuitting = true;
}

export async function sendIpcEventToRenderer< T extends keyof IpcEvents >(
	channel: T,
	...args: IpcEvents[ T ]
): Promise< void > {
	if ( isAppQuitting ) {
		return;
	}
	const window = getExistingMainWindow();
	if ( window && ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
		window.webContents.send( channel, ...args );
	}
}

export function sendIpcEventToRendererWithWindow< T extends keyof IpcEvents >(
	window: BrowserWindow | null,
	channel: T,
	...args: IpcEvents[ T ]
): void {
	if ( window && ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
		window.webContents.send( channel, ...args );
	}
}
