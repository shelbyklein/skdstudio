import { isValidLicenseSlug } from '@studio/common/lib/licenses';
import {
	deleteLicenseKey,
	isLicenseStorageAvailable,
	listLicenses,
	saveLicenseKey,
	type LicenseSummary,
} from 'src/storage/license-vault';
import type { IpcMainInvokeEvent } from 'electron';

export interface LicenseVaultState {
	available: boolean;
	licenses: LicenseSummary[];
}

/**
 * Metadata only. A stored key never crosses the IPC boundary — the renderer
 * needs to know that a license exists, not what it is.
 */
export async function getLicenses( _event: IpcMainInvokeEvent ): Promise< LicenseVaultState > {
	const available = isLicenseStorageAvailable();
	return {
		available,
		licenses: available ? await listLicenses() : [],
	};
}

export async function saveLicense(
	_event: IpcMainInvokeEvent,
	slug: string,
	label: string,
	key: string
): Promise< void > {
	const trimmedSlug = slug.trim();
	if ( ! isValidLicenseSlug( trimmedSlug ) ) {
		throw new Error(
			'A license name must start with a letter or number and use only letters, numbers, hyphens and underscores.'
		);
	}
	await saveLicenseKey( trimmedSlug, label.trim(), key.trim() );
}

export async function deleteLicense( _event: IpcMainInvokeEvent, slug: string ): Promise< void > {
	await deleteLicenseKey( slug );
}
