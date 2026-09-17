/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { planProjectMove, planSiteMove } from 'src/modules/projects/lib/plan-move';
import type { Project } from 'src/storage/storage-types';

function site( id: string, extra: Partial< SiteDetails > = {} ): SiteDetails {
	return { id, name: id, path: `/sites/${ id }`, running: false, ...extra } as SiteDetails;
}

const projects: Project[] = [
	{ id: 'sdhq', name: 'SDHQ', sortOrder: 1000 },
	{ id: 'sisol', name: 'Sisol', sortOrder: 2000 },
];

describe( 'planSiteMove', () => {
	it( 'moves an ungrouped site into a project', () => {
		const sites = [
			site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ),
			site( 'loose', { sortOrder: 1000 } ),
		];

		const updates = planSiteMove( sites, projects, 'loose', {
			type: 'container',
			projectId: 'sdhq',
		} );

		expect( updates ).toEqual( [
			{ siteId: 'dev', sortOrder: 1000, projectId: 'sdhq' },
			{ siteId: 'loose', sortOrder: 2000, projectId: 'sdhq' },
		] );
	} );

	it( 'ungroups a site with a null container', () => {
		const sites = [
			site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ),
			site( 'loose', { sortOrder: 1000 } ),
		];

		const updates = planSiteMove( sites, projects, 'dev', { type: 'container', projectId: null } );

		expect( updates ).toEqual( [
			{ siteId: 'loose', sortOrder: 1000, projectId: null },
			{ siteId: 'dev', sortOrder: 2000, projectId: null },
		] );
	} );

	it( 'inserts before the site it was dropped on, in that site’s project', () => {
		const sites = [
			site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ),
			site( 'staging', { projectId: 'sdhq', sortOrder: 2000 } ),
			site( 'loose', { sortOrder: 1000 } ),
		];

		const updates = planSiteMove( sites, projects, 'loose', {
			type: 'before-site',
			siteId: 'staging',
		} );

		expect( updates.map( ( { siteId } ) => siteId ) ).toEqual( [ 'dev', 'loose', 'staging' ] );
		expect( updates.every( ( { projectId } ) => projectId === 'sdhq' ) ).toBe( true );
	} );

	it( 'reorders within one project', () => {
		const sites = [
			site( 'a', { projectId: 'sdhq', sortOrder: 1000 } ),
			site( 'b', { projectId: 'sdhq', sortOrder: 2000 } ),
			site( 'c', { projectId: 'sdhq', sortOrder: 3000 } ),
		];

		const updates = planSiteMove( sites, projects, 'c', { type: 'before-site', siteId: 'a' } );

		expect( updates.map( ( { siteId } ) => siteId ) ).toEqual( [ 'c', 'a', 'b' ] );
	} );

	it( 'renumbers only the destination container', () => {
		const sites = [
			site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ),
			site( 'staging', { projectId: 'sdhq', sortOrder: 2000 } ),
			site( 'loose', { sortOrder: 1000 } ),
		];

		const updates = planSiteMove( sites, projects, 'staging', {
			type: 'container',
			projectId: null,
		} );

		expect( updates.map( ( { siteId } ) => siteId ) ).toEqual( [ 'loose', 'staging' ] );
		expect( updates.some( ( { siteId } ) => siteId === 'dev' ) ).toBe( false );
	} );

	it( 'does nothing when a site is dropped on itself', () => {
		const sites = [ site( 'a', { sortOrder: 1000 } ), site( 'b', { sortOrder: 2000 } ) ];

		expect( planSiteMove( sites, projects, 'a', { type: 'before-site', siteId: 'a' } ) ).toEqual(
			[]
		);
	} );

	it( 'does nothing when a site is dropped back where it already sits', () => {
		const sites = [ site( 'a', { sortOrder: 1000 } ), site( 'b', { sortOrder: 2000 } ) ];

		expect( planSiteMove( sites, projects, 'a', { type: 'before-site', siteId: 'b' } ) ).toEqual(
			[]
		);
	} );

	it( 'does nothing when an ungrouped site is dropped on the ungrouped list it ends', () => {
		const sites = [ site( 'a', { sortOrder: 1000 } ), site( 'b', { sortOrder: 2000 } ) ];

		expect( planSiteMove( sites, projects, 'b', { type: 'container', projectId: null } ) ).toEqual(
			[]
		);
	} );

	it( 'moves a site between two projects', () => {
		const sites = [
			site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ),
			site( 'other', { projectId: 'sisol', sortOrder: 1000 } ),
		];

		const updates = planSiteMove( sites, projects, 'dev', {
			type: 'container',
			projectId: 'sisol',
		} );

		expect( updates ).toEqual( [
			{ siteId: 'other', sortOrder: 1000, projectId: 'sisol' },
			{ siteId: 'dev', sortOrder: 2000, projectId: 'sisol' },
		] );
	} );

	it( 'appends to an empty project', () => {
		const sites = [ site( 'loose', { sortOrder: 1000 } ) ];

		const updates = planSiteMove( sites, projects, 'loose', {
			type: 'container',
			projectId: 'sisol',
		} );

		expect( updates ).toEqual( [ { siteId: 'loose', sortOrder: 1000, projectId: 'sisol' } ] );
	} );

	it( 'does nothing for a site that is not in the list', () => {
		expect(
			planSiteMove( [], projects, 'ghost', { type: 'container', projectId: 'sdhq' } )
		).toEqual( [] );
	} );
} );

describe( 'planProjectMove', () => {
	const three: Project[] = [
		{ id: 'a', name: 'A', sortOrder: 1000 },
		{ id: 'b', name: 'B', sortOrder: 2000 },
		{ id: 'c', name: 'C', sortOrder: 3000 },
	];

	it( 'moves a project before another', () => {
		expect( planProjectMove( three, 'c', 'a' ).map( ( { id } ) => id ) ).toEqual( [
			'c',
			'a',
			'b',
		] );
	} );

	it( 'moves a project later in the list', () => {
		expect( planProjectMove( three, 'a', 'c' ).map( ( { id } ) => id ) ).toEqual( [
			'b',
			'a',
			'c',
		] );
	} );

	it( 'leaves the list alone when dropped on itself', () => {
		expect( planProjectMove( three, 'b', 'b' ) ).toBe( three );
	} );

	it( 'leaves the list alone for an unknown project', () => {
		expect( planProjectMove( three, 'ghost', 'a' ) ).toBe( three );
		expect( planProjectMove( three, 'a', 'ghost' ) ).toBe( three );
	} );
} );
