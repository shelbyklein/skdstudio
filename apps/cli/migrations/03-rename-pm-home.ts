import fs from 'node:fs';
import path from 'node:path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import type { Migration } from '@studio/common/lib/migration';

function getStudioCliHome(): string {
	return getConfigDirectory();
}

function getLegacyPmHome(): string {
	return path.join( getStudioCliHome(), 'pm2' );
}

function getNewPmHome(): string {
	return path.join( getStudioCliHome(), 'daemon' );
}

export const renameProcessManagerHome: Migration = {
	needsToRun: async () => {
		return fs.existsSync( getLegacyPmHome() ) && ! fs.existsSync( getNewPmHome() );
	},
	run: async () => {
		fs.renameSync( getLegacyPmHome(), getNewPmHome() );
	},
};
