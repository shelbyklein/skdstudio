export const DEFAULT_WIDTH = 1100;
export const DEFAULT_HEIGHT = 820;
export const MAIN_MIN_HEIGHT = 600;
export const SIDEBAR_WIDTH = 208;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
export const MAIN_MIN_WIDTH = 712;
export const LOCAL_STORAGE_SIDEBAR_WIDTH_KEY = 'sidebar_width';
export const APP_CHROME_SPACING = 10;
export const MIN_WIDTH_CLASS_TO_MEASURE = 'app-measure-tabs-width';
export const MIN_WIDTH_SELECTOR_TO_MEASURE = `.${ MIN_WIDTH_CLASS_TO_MEASURE }`;
export const SCREENSHOT_WIDTH = 1040;
export const SCREENSHOT_HEIGHT = 1248;
export const UPDATED_MESSAGE_DURATION_MS = 60000; // 1 minute
export const MACOS_TRAFFIC_LIGHT_POSITION = { x: 20, y: 20 };
export const WINDOWS_TITLEBAR_HEIGHT = 44;
export const EMPTY_SITE_PLAYGROUND_URL = 'https://playground.wordpress.net/';
export const ABOUT_WINDOW_WIDTH = 300;
export const ABOUT_WINDOW_HEIGHT = 350;
export const REPOSITORY_URL = 'https://github.com/shelbyklein/skdstudio';
export const BUG_REPORT_URL = `${ REPOSITORY_URL }/issues/new`;
export { DEFAULT_TERMINAL } from '@studio/common/lib/user-settings/terminal';

// WP-CLI
export const WP_CLI_DEFAULT_RESPONSE_TIMEOUT = 5 * 60 * 1000; // 5min
export const WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS = 6;
export const WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT =
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS * 60 * 60 * 1000; // 6hr

// IPC handlers that don't return anything (i.e. that are called with `ipcRenderer.send`)
export const IPC_VOID_HANDLERS = [
	'logRendererMessage',
	'openCertificate',
	'openFileInIDE',
	'openLocalPath',
	'openSiteURL',
	'openStudioLogs',
	'openURL',
	'popupAppMenu',
	'showErrorMessageBox',
	'showProjectContextMenu',
	'showSiteContextMenu',
	'showItemInFolder',
	'showNotification',
] as const;
