import path from 'node:path';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __, sprintf } from '@wordpress/i18n';
import semver from 'semver';
import yargs from 'yargs';
import { registerCommand as registerDeployCommand } from 'cli/commands/deploy';
import { registerCommand as registerExportCommand } from 'cli/commands/export';
import { registerCommand as registerImportCommand } from 'cli/commands/import';
import { registerCommand as registerPullCommand } from 'cli/commands/pull';
import { registerCommand as registerSiteCreateCommand } from 'cli/commands/site/create';
import { registerCommand as registerSiteDeleteCommand } from 'cli/commands/site/delete';
import { registerCommand as registerSiteListCommand } from 'cli/commands/site/list';
import { registerCommand as registerSiteStartCommand } from 'cli/commands/site/start';
import { registerCommand as registerSiteStatusCommand } from 'cli/commands/site/status';
import { registerCommand as registerSiteStopCommand } from 'cli/commands/site/stop';
import { setupServerFiles } from 'cli/lib/dependency-management/setup';
import { loadTranslations } from 'cli/lib/i18n';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

const version = __STUDIO_CLI_VERSION__;

suppressPunycodeWarning();

async function main() {
	const yargsLocale = await loadTranslations();

	if ( semver.lt( process.version, __MINIMUM_NODE_VERSION__ ) ) {
		console.error(
			sprintf(
				__(
					'Studio CLI requires Node.js %s or newer. You are running %s.\nUpgrade Node.js and run this command again.\nDownload: https://nodejs.org/en/download'
				),
				__MINIMUM_NODE_VERSION__,
				process.version
			)
		);
		process.exit( 1 );
	}

	const studioArgv: StudioArgv = yargs( process.argv.slice( 2 ) )
		.scriptName( 'studio' )
		.usage( __( 'SKD Studio CLI' ) )
		.locale( yargsLocale )
		.version( version )
		.alias( 'v', 'version' )
		.alias( 'h', 'help' )
		.wrap( Math.min( 90, yargs().terminalWidth() ?? 90 ) )
		.option( 'path', {
			type: 'string',
			alias: 'p',
			normalize: true,
			default: process.cwd(),
			defaultDescription: __( 'Current directory' ),
			description: __( 'Path to the WordPress files' ),
			coerce: ( value ) => {
				return path.resolve( untildify( value ) );
			},
		} )
		.middleware( async () => {
			const { runMigrations } = await import( '@studio/common/lib/migration' );
			const { migrations } = await import( 'cli/migrations' );
			await runMigrations( migrations );

			const { prunePmLogs } = await import( 'cli/lib/prune-pm-logs' );
			await prunePmLogs();
		} )
		.middleware( async () => {
			await setupServerFiles();
		} );

	// Site management verbs are exposed at the top level (e.g. `studio create`,
	// `studio start`, `studio list`). These used to live under the `site` group,
	// which is kept hidden below for backward compatibility.
	registerSiteCreateCommand( studioArgv );
	registerSiteListCommand( studioArgv );
	registerSiteStartCommand( studioArgv );
	registerSiteStopCommand( studioArgv );
	registerSiteDeleteCommand( studioArgv );
	registerSiteStatusCommand( studioArgv );

	registerImportCommand( studioArgv );
	registerExportCommand( studioArgv );
	registerDeployCommand( studioArgv );
	registerPullCommand( studioArgv );

	// Per-site configuration lives under `config` (e.g. `studio config get php`,
	// `studio config set --php 8.3`).
	studioArgv.command( 'config', __( 'Manage site configuration' ), async ( configYargs ) => {
		const [
			{ registerCommand: registerConfigGetCommand },
			{ registerCommand: registerConfigSetCommand },
		] = await Promise.all( [
			import( 'cli/commands/config/get' ),
			import( 'cli/commands/config/set' ),
		] );

		registerConfigGetCommand( configYargs );
		registerConfigSetCommand( configYargs );
		configYargs
			.version( false )
			.demandCommand( 1, __( 'You must provide a valid config command' ) );
	} );

	studioArgv.command( {
		command: 'wp',
		describe: __( 'WP-CLI' ),
		builder: ( wpYargs ) => {
			return wpYargs.help( false ).showHelpOnFail( false ).strict( false ).version( false );
		},
		handler: async ( argv ) => {
			const { commandHandler: wpCliCommandHandler } = await import( 'cli/commands/wp' );

			return wpCliCommandHandler( argv );
		},
	} );

	studioArgv
		// Deprecated `site` group, kept hidden for backward compatibility. Every
		// subcommand is now available at the top level, and `site set` lives under
		// `config set`.
		.command( 'site', false, async ( sitesYargs ) => {
			const { registerCommand: registerSiteSetCommand } = await import( 'cli/commands/config/set' );

			registerSiteStatusCommand( sitesYargs );
			registerSiteCreateCommand( sitesYargs );
			registerSiteListCommand( sitesYargs );
			registerSiteStartCommand( sitesYargs );
			registerSiteStopCommand( sitesYargs );
			registerSiteDeleteCommand( sitesYargs );
			registerSiteSetCommand( sitesYargs );

			sitesYargs.version( false ).demandCommand( 1, __( 'You must provide a valid command' ) );
		} )
		.command( {
			command: '_events',
			describe: false, // Hidden command
			handler: async () => {
				const { commandHandler: eventsCommandHandler } = await import( 'cli/commands/_events' );

				return eventsCommandHandler();
			},
		} )
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	await studioArgv.argv;
}

void main();
