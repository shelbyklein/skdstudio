import path from 'path';
import { productName } from '../package.json';

export const DEFAULT_SITE_NAME = 'My WordPress Website';

/**
 * The directory Electron keeps app data in, named after the product. Derived
 * rather than written out, so renaming the app does not silently point these
 * tests at a directory the app no longer uses.
 */
export const APP_DATA_DIRNAME = productName;

/**
 * The directory name pre-split builds used, which the startup migration still
 * reads. It is the old product name and does not follow a rename.
 */
export const LEGACY_APP_DATA_DIRNAME = 'Studio';

// apps/studio/e2e/ up to the repo root, where test-fixtures/ lives.
export const REPO_ROOT = path.resolve( __dirname, '..', '..', '..' );
export const BACKUP_FIXTURES_DIR = path.join( REPO_ROOT, 'test-fixtures', 'backups' );
// Data-heavy artifacts fetched by `npm run e2e:fixtures` (see test-fixtures/readme.md).
export const DOWNLOADED_FIXTURES_DIR = path.join( REPO_ROOT, 'test-fixtures', 'downloads' );
