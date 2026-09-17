/**
 * Encrypted store for premium license keys.
 *
 * Keys are encrypted with Electron's `safeStorage`, which is backed by the OS
 * keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux), and the
 * ciphertext is kept in `~/.studio/licenses.json` — deliberately not `app.json`,
 * so a config file that is read and logged widely never carries secrets.
 *
 * Main process only: `safeStorage` is unavailable in the renderer, and plaintext
 * keys must never cross the IPC boundary. The CLI cannot read this vault either
 * (it is not an Electron process), which is why the desktop app resolves
 * Blueprint placeholders before handing the Blueprint to `studio site create`.
 *
 * When the OS has no usable keyring, storing is refused rather than silently
 * falling back to plaintext on disk.
 */

import { safeStorage } from 'electron';
import fs from 'node:fs';
import nodePath from 'node:path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { isValidLicenseSlug } from '@studio/common/lib/licenses';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import {
	getLicenseVaultLockFilePath,
	getLicenseVaultPath,
} from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { sanitizeUserpath } from 'src/lib/sanitize-for-logging';

interface VaultEntry {
	label: string;
	/** safeStorage ciphertext, base64. */
	secret: string;
	updatedAt: string;
}

interface Vault {
	version: 1;
	entries: Record< string, VaultEntry >;
}

/** What the renderer is allowed to know: that a key exists, never its value. */
export interface LicenseSummary {
	slug: string;
	label: string;
	updatedAt: string;
}

const EMPTY_VAULT: Vault = { version: 1, entries: {} };
const LOCKFILE_PATH = getLicenseVaultLockFilePath();

export function isLicenseStorageAvailable(): boolean {
	try {
		return safeStorage.isEncryptionAvailable();
	} catch {
		return false;
	}
}

async function loadVault(): Promise< Vault > {
	const filePath = getLicenseVaultPath();
	try {
		const parsed = JSON.parse( await readFile( filePath, 'utf-8' ) );
		return { version: 1, entries: parsed?.entries ?? {} };
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return EMPTY_VAULT;
		}
		console.error( `Failed to load file ${ sanitizeUserpath( filePath ) }: ${ err }` );
		throw err;
	}
}

async function saveVault( vault: Vault ): Promise< void > {
	const filePath = getLicenseVaultPath();
	const dir = nodePath.dirname( filePath );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	await writeFile( filePath, JSON.stringify( vault, null, 2 ) + '\n', {
		encoding: 'utf-8',
		mode: 0o600,
	} );
}

async function lockVault(): Promise< () => Promise< void > > {
	const dir = nodePath.dirname( LOCKFILE_PATH );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	await lockFileAsync( LOCKFILE_PATH, {
		stale: LOCKFILE_STALE_TIME,
		wait: LOCKFILE_WAIT_TIME,
	} );
	return () => unlockFileAsync( LOCKFILE_PATH );
}

export async function listLicenses(): Promise< LicenseSummary[] > {
	const vault = await loadVault();
	return Object.entries( vault.entries )
		.map( ( [ slug, entry ] ) => ( {
			slug,
			label: entry.label,
			updatedAt: entry.updatedAt,
		} ) )
		.sort( ( a, b ) => a.slug.localeCompare( b.slug ) );
}

/**
 * Decrypt one key. Main process only — never return this over IPC.
 */
export async function readLicenseKey( slug: string ): Promise< string | undefined > {
	const vault = await loadVault();
	const entry = vault.entries[ slug ];
	if ( ! entry ) {
		return undefined;
	}
	if ( ! isLicenseStorageAvailable() ) {
		throw new Error( 'License storage is unavailable: no OS keyring.' );
	}
	try {
		return safeStorage.decryptString( Buffer.from( entry.secret, 'base64' ) );
	} catch ( error ) {
		// A vault written under a different OS user or a reset keychain cannot be
		// decrypted. Treat it as absent so creation reports it missing rather than
		// failing outright.
		console.error( `Failed to decrypt license "${ slug }": ${ error }` );
		return undefined;
	}
}

/**
 * Decrypt several keys at once, skipping any that are absent or undecryptable.
 */
export async function readLicenseKeys( slugs: string[] ): Promise< Record< string, string > > {
	const keys: Record< string, string > = {};
	for ( const slug of slugs ) {
		const key = await readLicenseKey( slug );
		if ( key !== undefined ) {
			keys[ slug ] = key;
		}
	}
	return keys;
}

export async function saveLicenseKey( slug: string, label: string, key: string ): Promise< void > {
	if ( ! isValidLicenseSlug( slug ) ) {
		throw new Error( `Invalid license slug: "${ slug }"` );
	}
	if ( ! key ) {
		throw new Error( 'A license key is required.' );
	}
	if ( ! isLicenseStorageAvailable() ) {
		throw new Error(
			'License storage is unavailable because this system has no usable keyring, and Studio will not write license keys to disk unencrypted.'
		);
	}

	const secret = safeStorage.encryptString( key ).toString( 'base64' );
	const unlock = await lockVault();
	try {
		const vault = await loadVault();
		vault.entries[ slug ] = {
			label: label || slug,
			secret,
			updatedAt: new Date().toISOString(),
		};
		await saveVault( vault );
	} finally {
		await unlock();
	}
}

export async function deleteLicenseKey( slug: string ): Promise< void > {
	const unlock = await lockVault();
	try {
		const vault = await loadVault();
		delete vault.entries[ slug ];
		await saveVault( vault );
	} finally {
		await unlock();
	}
}
