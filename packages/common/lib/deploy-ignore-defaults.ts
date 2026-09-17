export const DEPLOY_IGNORE_DEFAULTS = [ '.git', 'node_modules', '.DS_Store', 'Thumbs.db' ];

/**
 * Patterns excluded when exporting a site for deployment. Pre-seeded on top of
 * DEPLOY_IGNORE_DEFAULTS and overridable via negation patterns in .deployignore.
 * Dotfiles are deliberately not excluded wholesale; add your own patterns to
 * .deployignore for stricter filtering.
 */
export const EXPORT_DEPLOY_IGNORE_DEFAULTS = [
	...DEPLOY_IGNORE_DEFAULTS,
	'database',
	'db.php',
	'debug.log',
	'studio-error.log',
	'sqlite-database-integration',
	'cache',
];
