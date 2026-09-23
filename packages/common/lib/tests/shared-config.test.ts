import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import {
	readSharedConfig,
	saveSharedConfig,
	lockSharedConfig,
	unlockSharedConfig,
	updateSharedConfig,
	SharedConfigVersionMismatchError,
} from '@studio/common/lib/shared-config';
import {
	getConfigDirectory as getSharedConfigDirectory,
	getSharedConfigPath,
} from '@studio/common/lib/well-known-paths';
import type { SharedConfig } from '@studio/common/lib/shared-config';

vi.mock( 'fs' );
vi.mock( 'os', () => ( {
	default: {
		homedir: vi.fn(),
	},
} ) );
vi.mock( 'path', () => ( {
	default: {
		join: vi.fn(),
	},
} ) );
vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/lockfile', () => ( {
	lockFileAsync: vi.fn().mockResolvedValue( undefined ),
	unlockFileAsync: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'Shared Config', () => {
	const mockHomeDir = '/mock/home';

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( os.homedir ).mockReturnValue( mockHomeDir );
		vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( '{}' ) );
		vi.mocked( writeFile ).mockResolvedValue( undefined );
		delete process.env.E2E;
		delete process.env.E2E_SHARED_CONFIG_PATH;
	} );

	describe( 'getSharedConfigDirectory', () => {
		it( 'should return ~/.skdstudio by default', () => {
			expect( getSharedConfigDirectory() ).toBe( `${ mockHomeDir }/.skdstudio` );
		} );

		it( 'should use E2E override when set', () => {
			process.env.E2E = '1';
			process.env.E2E_SHARED_CONFIG_PATH = '/custom/path';
			expect( getSharedConfigDirectory() ).toBe( '/custom/path' );
		} );
	} );

	describe( 'getSharedConfigPath', () => {
		it( 'should return path to shared.json', () => {
			expect( getSharedConfigPath() ).toBe( `${ mockHomeDir }/.skdstudio/shared.json` );
		} );
	} );

	describe( 'readSharedConfig', () => {
		it( 'should return default config when file does not exist', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			const config = await readSharedConfig();
			expect( config ).toEqual( { version: 1 } );
		} );

		it( 'should parse valid shared.json', async () => {
			const data = {
				version: 1,
				locale: 'en',
			};
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

			const config = await readSharedConfig();
			expect( config.locale ).toBe( 'en' );
		} );

		it( 'should return defaults on malformed JSON', async () => {
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( 'not json' ) );
			const config = await readSharedConfig();
			expect( config ).toEqual( { version: 1 } );
		} );

		it( 'should return defaults on invalid schema', async () => {
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from( JSON.stringify( { version: 'invalid' } ) )
			);
			const config = await readSharedConfig();
			expect( config ).toEqual( { version: 1 } );
		} );

		it( 'should throw SharedConfigVersionMismatchError when version differs from current', async () => {
			const data = { version: 2, locale: 'en' };
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

			await expect( readSharedConfig() ).rejects.toThrow( SharedConfigVersionMismatchError );
		} );

		it( 'should preserve unknown fields with loose schema', async () => {
			const data = { version: 1, unknownField: 'value' };
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

			const config = await readSharedConfig();
			expect( ( config as Record< string, unknown > ).unknownField ).toBe( 'value' );
		} );
	} );

	describe( 'saveSharedConfig', () => {
		it( 'should write JSON to shared.json', async () => {
			const config = { version: 1 as const, locale: 'en' };
			try {
				await lockSharedConfig();
				await saveSharedConfig( config );
			} finally {
				await unlockSharedConfig();
			}

			expect( writeFile ).toHaveBeenCalledWith(
				`${ mockHomeDir }/.skdstudio/shared.json`,
				JSON.stringify( { version: 1, locale: 'en' }, null, 2 ) + '\n',
				{ encoding: 'utf8' }
			);
		} );

		it( 'should create directory if it does not exist', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			try {
				await lockSharedConfig();
				await saveSharedConfig( { version: 1 } );
			} finally {
				await unlockSharedConfig();
			}

			expect( fs.mkdirSync ).toHaveBeenCalledWith( `${ mockHomeDir }/.skdstudio`, {
				recursive: true,
			} );
		} );

		it( 'should set version to 1', async () => {
			const config = { version: 99 } as unknown as SharedConfig;
			try {
				await lockSharedConfig();
				await saveSharedConfig( config );
			} finally {
				await unlockSharedConfig();
			}

			const written = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ] as string;
			expect( JSON.parse( written ).version ).toBe( 1 );
		} );
	} );

	describe( 'updateSharedConfig', () => {
		it( 'should merge partial updates', async () => {
			const existing = { version: 1, locale: 'en' };
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( existing ) ) );

			await updateSharedConfig( { locale: 'fr' } );

			const written = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ] as string;
			const saved = JSON.parse( written );
			expect( saved.locale ).toBe( 'fr' );
		} );
	} );
} );
