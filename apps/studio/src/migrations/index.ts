import { migrateAppConfig } from './02-migrate-to-split-config';
import { copyHttpsCertsToWellKnown } from './03-copy-https-certs-to-well-known';
import { removeOldServerFilesAndCertificates } from './05-remove-old-server-files-and-certificates';
import { setCliUserUninstalled } from './06-set-cli-user-uninstalled';
import { removeDesksConfig } from './07-remove-desks-config';
import { relocateAutostartToAppJson } from './08-relocate-autostart-to-app-json';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	migrateAppConfig,
	copyHttpsCertsToWellKnown,
	removeOldServerFilesAndCertificates,
	setCliUserUninstalled,
	removeDesksConfig,
	relocateAutostartToAppJson,
];
