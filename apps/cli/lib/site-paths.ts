import path from 'path';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

export const STUDIO_SITES_ROOT = path.join( getConfigDirectory(), 'sites' );

export function getDefaultSitePath( siteName: string ): string {
	const folderName = sanitizeFolderName( siteName );
	return path.join( STUDIO_SITES_ROOT, folderName );
}
