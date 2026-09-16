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
