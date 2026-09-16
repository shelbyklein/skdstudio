import fs from 'fs';
import {
	CLI_CONFIG_VERSION,
	ensureCliConfigDirectory,
	lockCliConfigFile,
	readCliConfigFileRaw,
	unlockCliConfigFile,
	writeCliConfigFileRaw,
} from '@studio/common/lib/cli-config-file';
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { siteOperationSchema } from '@studio/common/lib/site-operation';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

const siteSchema = siteDetailsSchema
	.extend( {
		url: z.string().optional(),
		latestCliPid: z.number().optional(),
		// The in-flight Studio operation holding this site. It's transient: once
		// its owning process is gone it's reclaimed on the next acquire. See
		// `cli/lib/site-operations`.
		operation: siteOperationSchema.optional(),
	} )
	.loose();

// Schema updates must maintain backwards compatibility. If a breaking change is needed,
// increment CLI_CONFIG_VERSION (in @studio/common/lib/cli-config-file) and add a data migration
// function.

// IMPORTANT: Always consider that independently installed versions of the CLI may also
// read this file, and any updates to this schema may require updating the `version` field.
const cliConfigSchema = z.looseObject( {
	version: z.literal( CLI_CONFIG_VERSION ),
	sites: z.array( siteSchema ).default( () => [] ),
	lastDependencyCheckTime: z.number().optional(),
} );

type CliConfig = z.infer< typeof cliConfigSchema >;
export type SiteData = z.infer< typeof siteSchema >;

const DEFAULT_CLI_CONFIG: CliConfig = {
	version: CLI_CONFIG_VERSION,
	sites: [],
};

export async function readCliConfig(): Promise< CliConfig > {
	if ( ! fs.existsSync( getCliConfigPath() ) ) {
		return structuredClone( DEFAULT_CLI_CONFIG );
	}

	let data: Record< string, unknown >;
	try {
		data = await readCliConfigFileRaw();
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to read CLI config file.' ), error );
	}

	try {
		return cliConfigSchema.parse( data );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			if ( typeof data?.version === 'number' && data.version !== CLI_CONFIG_VERSION ) {
				throw new LoggerError(
					__(
						'Invalid CLI config version. It looks like you have a different version of the `studio` CLI installed on your system. Please modify your $PATH environment variable to use the correct version.'
					),
					error
				);
			}

			throw new LoggerError( __( 'Invalid CLI config file format.' ), error );
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError( __( 'CLI config file is corrupted.' ), error );
		}

		throw new LoggerError( __( 'Failed to read CLI config file.' ), error );
	}
}

export async function saveCliConfig( config: CliConfig ): Promise< void > {
	try {
		config.version = CLI_CONFIG_VERSION;
		await ensureCliConfigDirectory();
		await writeCliConfigFileRaw( config );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to save CLI config file' ), error );
	}
}

export const lockCliConfig = lockCliConfigFile;
export const unlockCliConfig = unlockCliConfigFile;

export async function updateCliConfigWithPartial(
	update: Partial< Omit< CliConfig, 'version' | 'sites' > >
): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const updated = { ...config, ...update };
		await saveCliConfig( updated );
	} finally {
		await unlockCliConfig();
	}
}
