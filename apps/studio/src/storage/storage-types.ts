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
	/** The project this site belongs to. Absent, or naming no project, means ungrouped. */
	projectId?: string;
}

/**
 * A sidebar folder holding sites. Desktop-only: the CLI has no concept of one.
 *
 * Not to be confused with the removed upstream `desks` feature — the migration at
 * `src/migrations/07-remove-desks-config.ts` still deletes a top-level `desks` key on sight.
 */
export interface Project {
	id: string;
	name: string;
	/** Same `( index + 1 ) * 1000` scheme as a site's. */
	sortOrder: number;
	collapsed?: boolean;
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
	projects?: Project[];
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
