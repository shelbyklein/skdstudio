import { collectLicenseSlugs, resolveLicensePlaceholders } from '@studio/common/lib/licenses';
import { readLicenseKeys } from 'src/storage/license-vault';
import type { Blueprint as PlaygroundBlueprint } from '@wp-playground/blueprints';

/**
 * Substitute vault keys into a Blueprint's `${studio.license:<slug>}`
 * placeholders just before the site is created.
 *
 * This runs in the desktop app rather than the CLI because the vault is
 * encrypted with Electron's `safeStorage`, which a plain Node process cannot
 * read. The CLI therefore receives a Blueprint whose keys are already filled in.
 *
 * A slug with no stored key is left as a placeholder and logged; see
 * `resolveLicensePlaceholders` for why an unresolved placeholder is preferable
 * to writing a bogus key into wp-config.php.
 */
export async function applyLicensesToBlueprint(
	blueprint: Record< string, unknown > | undefined
): Promise< Record< string, unknown > | undefined > {
	if ( ! blueprint ) {
		return blueprint;
	}

	const slugs = collectLicenseSlugs( blueprint as PlaygroundBlueprint );
	if ( slugs.length === 0 ) {
		return blueprint;
	}

	const keys = await readLicenseKeys( slugs );
	const { blueprint: resolved, missing } = resolveLicensePlaceholders(
		blueprint as PlaygroundBlueprint,
		( slug ) => keys[ slug ]
	);

	if ( missing.length > 0 ) {
		console.warn(
			`Blueprint needs license keys that are not stored: ${ missing.join(
				', '
			) }. The site will be created without them.`
		);
	}

	return resolved as Record< string, unknown >;
}
