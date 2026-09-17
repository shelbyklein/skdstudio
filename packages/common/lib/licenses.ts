/**
 * Premium license keys for Blueprints.
 *
 * A Blueprint declares *where* a license key belongs without containing the key
 * itself, by using a `${studio.license:<slug>}` placeholder in a `constants` or
 * `siteOptions` value. Studio substitutes the key from the user's vault when the
 * site is created, so a Blueprint stays safe to share.
 *
 * Placeholders are confined to those two fields on purpose. The Blueprint schema
 * (`@wp-playground/blueprints`) sets `additionalProperties: false` at the top
 * level and on `meta`, so a custom key would fail validation; `constants` and
 * `siteOptions` both accept arbitrary strings and between them cover how premium
 * plugins read a key — a PHP constant (Bricks) or a WordPress option (ACSS).
 */

import type { Blueprint } from '@wp-playground/blueprints';

const PLACEHOLDER_PATTERN = /\$\{studio\.license:([a-zA-Z0-9][a-zA-Z0-9_-]*)\}/g;

export const LICENSE_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export interface LicenseResolution {
	blueprint: Blueprint;
	/** Slugs that were found and substituted. */
	resolved: string[];
	/** Slugs the Blueprint asked for that the vault has no key for. */
	missing: string[];
}

export function isValidLicenseSlug( slug: string ): boolean {
	return LICENSE_SLUG_PATTERN.test( slug );
}

function collectFromRecord( record: unknown, slugs: Set< string > ): void {
	if ( ! record || typeof record !== 'object' ) {
		return;
	}
	for ( const value of Object.values( record as Record< string, unknown > ) ) {
		if ( typeof value !== 'string' ) {
			continue;
		}
		for ( const match of value.matchAll( PLACEHOLDER_PATTERN ) ) {
			slugs.add( match[ 1 ] );
		}
	}
}

/**
 * Every license slug a Blueprint refers to, in first-seen order.
 */
export function collectLicenseSlugs( blueprint: Blueprint | undefined ): string[] {
	const slugs = new Set< string >();
	if ( ! blueprint ) {
		return [];
	}
	const declaration = blueprint as Record< string, unknown >;
	collectFromRecord( declaration.constants, slugs );
	collectFromRecord( declaration.siteOptions, slugs );
	return [ ...slugs ];
}

function substituteRecord(
	record: unknown,
	getKey: ( slug: string ) => string | undefined,
	resolved: Set< string >,
	missing: Set< string >
): unknown {
	if ( ! record || typeof record !== 'object' ) {
		return record;
	}

	const source = record as Record< string, unknown >;
	const result: Record< string, unknown > = {};

	for ( const [ name, value ] of Object.entries( source ) ) {
		if ( typeof value !== 'string' ) {
			result[ name ] = value;
			continue;
		}
		result[ name ] = value.replace( PLACEHOLDER_PATTERN, ( placeholder, slug: string ) => {
			const key = getKey( slug );
			if ( key === undefined || key === '' ) {
				missing.add( slug );
				return placeholder;
			}
			resolved.add( slug );
			return key;
		} );
	}

	return result;
}

/**
 * Replace every `${studio.license:<slug>}` placeholder with the matching key.
 *
 * Returns a new Blueprint; the input is never mutated. A placeholder with no key
 * in the vault is **left in place** and reported in `missing` — writing an
 * unresolved placeholder into wp-config.php as if it were a license would be
 * worse than leaving the site unlicensed, so callers are expected to surface
 * `missing` rather than ignore it.
 */
export function resolveLicensePlaceholders(
	blueprint: Blueprint,
	getKey: ( slug: string ) => string | undefined
): LicenseResolution {
	const resolved = new Set< string >();
	const missing = new Set< string >();
	const declaration = blueprint as Record< string, unknown >;

	const next: Record< string, unknown > = { ...declaration };

	if ( declaration.constants ) {
		next.constants = substituteRecord( declaration.constants, getKey, resolved, missing );
	}
	if ( declaration.siteOptions ) {
		next.siteOptions = substituteRecord( declaration.siteOptions, getKey, resolved, missing );
	}

	return {
		blueprint: next as Blueprint,
		resolved: [ ...resolved ],
		missing: [ ...missing ],
	};
}
