/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createProject,
	deleteProject,
	getProjects,
	renameProject,
	setProjectCollapsed,
	setSiteProject,
	updateProjectsSortOrder,
} from 'src/modules/projects/lib/ipc-handlers';
import type { IpcMainInvokeEvent } from 'electron';
import type { UserData } from 'src/storage/storage-types';

const { lockAppdataMock, unlockAppdataMock, loadUserDataMock, saveUserDataMock } = vi.hoisted(
	() => ( {
		lockAppdataMock: vi.fn(),
		unlockAppdataMock: vi.fn(),
		loadUserDataMock: vi.fn(),
		saveUserDataMock: vi.fn(),
	} )
);

vi.mock( 'src/storage/user-data', () => ( {
	lockAppdata: lockAppdataMock,
	unlockAppdata: unlockAppdataMock,
	loadUserData: loadUserDataMock,
	saveUserData: saveUserDataMock,
} ) );

const event = {} as IpcMainInvokeEvent;

let stored: UserData;

function setStored( userData: Partial< UserData > ) {
	stored = { version: 1, siteMetadata: {}, ...userData };
	loadUserDataMock.mockResolvedValue( stored );
}

/** What the handler under test persisted. */
function saved(): UserData {
	expect( saveUserDataMock ).toHaveBeenCalled();
	return saveUserDataMock.mock.calls.at( -1 )![ 0 ];
}

beforeEach( () => {
	vi.clearAllMocks();
	setStored( {} );
} );

describe( 'getProjects', () => {
	it( 'returns an empty list when none have ever been created', async () => {
		await expect( getProjects( event ) ).resolves.toEqual( [] );
	} );

	it( 'orders projects by sortOrder rather than storage order', async () => {
		setStored( {
			projects: [
				{ id: 'b', name: 'Second', sortOrder: 2000 },
				{ id: 'a', name: 'First', sortOrder: 1000 },
			],
		} );

		const projects = await getProjects( event );

		expect( projects.map( ( { name } ) => name ) ).toEqual( [ 'First', 'Second' ] );
	} );
} );

describe( 'createProject', () => {
	it( 'appends after the existing projects', async () => {
		setStored( { projects: [ { id: 'a', name: 'First', sortOrder: 1000 } ] } );

		const project = await createProject( event, 'Second' );

		expect( project.name ).toBe( 'Second' );
		expect( project.sortOrder ).toBe( 2000 );
		expect( saved().projects ).toHaveLength( 2 );
	} );

	it( 'trims the name', async () => {
		const project = await createProject( event, '  SDHQ  ' );

		expect( project.name ).toBe( 'SDHQ' );
	} );

	it( 'refuses a blank name without writing', async () => {
		await expect( createProject( event, '   ' ) ).rejects.toThrow();
		expect( saveUserDataMock ).not.toHaveBeenCalled();
	} );

	it( 'releases the lock it took', async () => {
		await createProject( event, 'SDHQ' );

		expect( lockAppdataMock ).toHaveBeenCalledOnce();
		expect( unlockAppdataMock ).toHaveBeenCalledOnce();
	} );

	it( 'releases the lock even when the write fails', async () => {
		saveUserDataMock.mockRejectedValueOnce( new Error( 'disk full' ) );

		await expect( createProject( event, 'SDHQ' ) ).rejects.toThrow( 'disk full' );
		expect( unlockAppdataMock ).toHaveBeenCalledOnce();
	} );
} );

describe( 'renameProject', () => {
	beforeEach( () => {
		setStored( { projects: [ { id: 'a', name: 'Old', sortOrder: 1000 } ] } );
	} );

	it( 'renames in place', async () => {
		await renameProject( event, 'a', 'New' );

		expect( saved().projects?.[ 0 ].name ).toBe( 'New' );
	} );

	it( 'refuses a blank name without writing', async () => {
		await expect( renameProject( event, 'a', '  ' ) ).rejects.toThrow();
		expect( saveUserDataMock ).not.toHaveBeenCalled();
	} );

	it( 'ignores an unknown project', async () => {
		await expect( renameProject( event, 'nope', 'New' ) ).resolves.toBeUndefined();
		expect( saved().projects?.[ 0 ].name ).toBe( 'Old' );
	} );
} );

describe( 'deleteProject', () => {
	beforeEach( () => {
		setStored( {
			projects: [
				{ id: 'a', name: 'Doomed', sortOrder: 1000 },
				{ id: 'b', name: 'Kept', sortOrder: 2000 },
			],
			siteMetadata: {
				'site-1': { projectId: 'a', sortOrder: 1000, autoStart: true },
				'site-2': { projectId: 'b', sortOrder: 1000 },
				'site-3': { sortOrder: 2000 },
			},
		} );
	} );

	it( 'removes only that project', async () => {
		await deleteProject( event, 'a' );

		expect( saved().projects ).toEqual( [ { id: 'b', name: 'Kept', sortOrder: 2000 } ] );
	} );

	it( 'ungroups its sites without deleting them or their other metadata', async () => {
		await deleteProject( event, 'a' );

		const { siteMetadata } = saved();
		expect( siteMetadata[ 'site-1' ] ).toEqual( { sortOrder: 1000, autoStart: true } );
		expect( siteMetadata[ 'site-2' ].projectId ).toBe( 'b' );
		expect( Object.keys( siteMetadata ) ).toHaveLength( 3 );
	} );
} );

describe( 'setProjectCollapsed', () => {
	it( 'persists the collapsed state', async () => {
		setStored( { projects: [ { id: 'a', name: 'SDHQ', sortOrder: 1000 } ] } );

		await setProjectCollapsed( event, 'a', true );

		expect( saved().projects?.[ 0 ].collapsed ).toBe( true );
	} );
} );

describe( 'updateProjectsSortOrder', () => {
	it( 'applies every update in one write', async () => {
		setStored( {
			projects: [
				{ id: 'a', name: 'First', sortOrder: 1000 },
				{ id: 'b', name: 'Second', sortOrder: 2000 },
			],
		} );

		await updateProjectsSortOrder( event, [
			{ projectId: 'a', sortOrder: 2000 },
			{ projectId: 'b', sortOrder: 1000 },
		] );

		expect( saveUserDataMock ).toHaveBeenCalledOnce();
		expect( saved().projects ).toEqual( [
			{ id: 'a', name: 'First', sortOrder: 2000 },
			{ id: 'b', name: 'Second', sortOrder: 1000 },
		] );
	} );

	it( 'skips an unknown project rather than throwing', async () => {
		setStored( { projects: [ { id: 'a', name: 'First', sortOrder: 1000 } ] } );

		await expect(
			updateProjectsSortOrder( event, [ { projectId: 'gone', sortOrder: 5000 } ] )
		).resolves.toBeUndefined();
	} );
} );

describe( 'setSiteProject', () => {
	it( 'puts a site in a project without touching its other metadata', async () => {
		setStored( { siteMetadata: { 'site-1': { sortOrder: 1000, autoStart: true } } } );

		await setSiteProject( event, 'site-1', 'sdhq' );

		expect( saved().siteMetadata[ 'site-1' ] ).toEqual( {
			sortOrder: 1000,
			autoStart: true,
			projectId: 'sdhq',
		} );
	} );

	it( 'ungroups a site with null', async () => {
		setStored( { siteMetadata: { 'site-1': { projectId: 'sdhq', sortOrder: 1000 } } } );

		await setSiteProject( event, 'site-1', null );

		expect( saved().siteMetadata[ 'site-1' ] ).toEqual( { sortOrder: 1000 } );
	} );

	it( 'records a site it has never seen before', async () => {
		await setSiteProject( event, 'brand-new', 'sdhq' );

		expect( saved().siteMetadata[ 'brand-new' ] ).toEqual( { projectId: 'sdhq' } );
	} );
} );
