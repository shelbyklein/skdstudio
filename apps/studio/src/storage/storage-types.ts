import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import type { QuitSitesBehavior } from '@studio/common/lib/user-settings/preferences';
import type { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	isFullScreen?: boolean;
}

export type { QuitSitesBehavior };

export interface AppdataSiteData {
	themeDetails?: SiteDetails[ 'themeDetails' ];
	siteIconPath?: SiteDetails[ 'siteIconPath' ];
	sortOrder?: number;
	autoStart?: boolean;
}

export interface UserData {
	version: 1;
	siteMetadata: Record< string, AppdataSiteData >;
	devToolsOpen?: boolean;
	windowBounds?: WindowBounds;
	promptWindowsSpeedUpResult?: PromptWindowsSpeedUpResult;
	preferredTerminal?: SupportedTerminal;
	preferredEditor?: SupportedEditor;
	colorScheme?: 'system' | 'light' | 'dark';
	quitSitesBehavior?: QuitSitesBehavior;
	defaultSiteDirectory?: string;
	/** @deprecated Used only for migration to cliUserUninstalled. Do not write; remove after one release cycle. */
	cliAutoInstalled?: boolean;
	cliUserUninstalled?: boolean;
}

export interface PromptWindowsSpeedUpResult {
	response: 'yes' | 'no';
	appVersion: string;
	dontAskAgain: boolean;
}

export const EMPTY_USER_DATA: UserData = {
	version: 1,
	siteMetadata: {},
};
