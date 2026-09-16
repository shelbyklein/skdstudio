/**
 * Paths a deploy must never copy to a server.
 *
 * Two kinds of thing. `wp-config.php` belongs to the server: it holds that
 * host's database credentials and salts, and replacing it points the live site
 * at a database that does not exist. Everything else is Studio's own local
 * scaffolding — the SQLite integration that stands in for MySQL, and the
 * mu-plugin loader that points at a temp directory on this machine — which is
 * meaningless or actively broken anywhere else.
 *
 * The Studio-specific half deliberately mirrors what `DefaultExporter` skips,
 * so a deployed site and an exported archive contain the same files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { EXPORT_DEPLOY_IGNORE_DEFAULTS } from '@studio/common/lib/deploy-ignore-defaults';
import {
	LEGACY_MU_PLUGIN_FILENAMES,
	STUDIO_ERROR_LOG_FILENAME,
	STUDIO_LOADER_MU_PLUGIN_FILENAME,
} from '@studio/common/lib/mu-plugins';

export const DEPLOY_ALWAYS_EXCLUDED: string[] = [
	'wp-config.php',
	'.deployignore',
	'wp-content/db.php',
	'wp-content/database/',
	'wp-content/debug.log',
	`wp-content/${ STUDIO_ERROR_LOG_FILENAME }`,
	'wp-content/plugins/sqlite-database-integration/',
	'wp-content/mu-plugins/sqlite-database-integration/',
	`wp-content/mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`,
	...LEGACY_MU_PLUGIN_FILENAMES.map( ( filename ) => `wp-content/mu-plugins/${ filename }` ),
];

/**
 * The full exclude list for one site: the paths above, Studio's export
 * defaults, and the site's own `.deployignore`.
 *
 * rsync does the matching rather than the shared ignore filter, because it is
 * the only one that sees both sides and can act while walking the tree. The
 * same list is used pushing and pulling, so the two directions agree on what
 * belongs to the local machine and what belongs to the server.
 */
export async function buildExcludePatterns( sitePath: string ): Promise< string[] > {
	const patterns = new Set< string >( [
		...DEPLOY_ALWAYS_EXCLUDED,
		...EXPORT_DEPLOY_IGNORE_DEFAULTS,
	] );

	try {
		const contents = await fs.readFile( path.join( sitePath, '.deployignore' ), 'utf8' );
		for ( const line of contents.split( '\n' ) ) {
			const pattern = line.trim();
			if ( pattern && ! pattern.startsWith( '#' ) ) {
				patterns.add( pattern );
			}
		}
	} catch {
		// No .deployignore is the common case.
	}

	return [ ...patterns ];
}

/** Writes the exclude list where rsync's `--exclude-from` can read it. */
export async function buildExcludeFile( sitePath: string, workDir: string ): Promise< string > {
	const patterns = await buildExcludePatterns( sitePath );
	const excludeFile = path.join( workDir, 'rsync-exclude.txt' );
	await fs.writeFile( excludeFile, `${ patterns.join( '\n' ) }\n`, 'utf8' );
	return excludeFile;
}
