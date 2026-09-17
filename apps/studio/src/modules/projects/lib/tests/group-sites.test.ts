/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { groupSites, sitesInContainer } from 'src/modules/projects/lib/group-sites';
import type { Project } from 'src/storage/storage-types';

function site( id: string, extra: Partial< SiteDetails > = {} ): SiteDetails {
	return { id, name: id, path: `/sites/${ id }`, running: false, ...extra } as SiteDetails;
}

const projects: Project[] = [
	{ id: 'sdhq', name: 'SDHQ', sortOrder: 1000 },
	{ id: 'sisol', name: 'Sisol', sortOrder: 2000 },
];

describe( 'groupSites', () => {
	it( 'puts every site in the ungrouped list when there are no projects', () => {
		const sites = [ site( 'a' ), site( 'b' ) ];

		const grouped = groupSites( sites, [] );

		expect( grouped.projects ).toEqual( [] );
		expect( grouped.ungrouped.map( ( { id } ) => id ) ).toEqual( [ 'a', 'b' ] );
	} );

	it( 'files sites under the project they name', () => {
		const sites = [
			site( 'dev', { projectId: 'sdhq' } ),
			site( 'loose' ),
			site( 'staging', { projectId: 'sdhq' } ),
		];

		const grouped = groupSites( sites, projects );

		expect( grouped.projects[ 0 ].project.name ).toBe( 'SDHQ' );
		expect( grouped.projects[ 0 ].sites.map( ( { id } ) => id ) ).toEqual( [ 'dev', 'staging' ] );
		expect( grouped.projects[ 1 ].sites ).toEqual( [] );
		expect( grouped.ungrouped.map( ( { id } ) => id ) ).toEqual( [ 'loose' ] );
	} );

	it( 'keeps an empty project so it stays a visible drop target', () => {
		const grouped = groupSites( [], projects );

		expect( grouped.projects ).toHaveLength( 2 );
	} );

	it( 'treats a projectId naming no project as ungrouped rather than losing the site', () => {
		const sites = [ site( 'orphan', { projectId: 'deleted-long-ago' } ) ];

		const grouped = groupSites( sites, projects );

		expect( grouped.ungrouped.map( ( { id } ) => id ) ).toEqual( [ 'orphan' ] );
	} );

	it( 'orders projects by sortOrder', () => {
		const grouped = groupSites( [], [ projects[ 1 ], projects[ 0 ] ] );

		expect( grouped.projects.map( ( { project } ) => project.name ) ).toEqual( [
			'SDHQ',
			'Sisol',
		] );
	} );

	it( 'orders sites within each container, independently of other containers', () => {
		const sites = [
			site( 'second', { projectId: 'sdhq', sortOrder: 2000 } ),
			site( 'first', { projectId: 'sdhq', sortOrder: 1000 } ),
			// Deliberately reuses the sort values: order is per container, not global.
			site( 'loose-second', { sortOrder: 2000 } ),
			site( 'loose-first', { sortOrder: 1000 } ),
		];

		const grouped = groupSites( sites, projects );

		expect( grouped.projects[ 0 ].sites.map( ( { id } ) => id ) ).toEqual( [ 'first', 'second' ] );
		expect( grouped.ungrouped.map( ( { id } ) => id ) ).toEqual( [
			'loose-first',
			'loose-second',
		] );
	} );

	it( 'does not mutate the arrays it was given', () => {
		const sites = [ site( 'b', { sortOrder: 2000 } ), site( 'a', { sortOrder: 1000 } ) ];
		const order = [ ...projects ].reverse();

		groupSites( sites, order );

		expect( sites.map( ( { id } ) => id ) ).toEqual( [ 'b', 'a' ] );
		expect( order[ 0 ].id ).toBe( 'sisol' );
	} );
} );

describe( 'sitesInContainer', () => {
	const grouped = groupSites( [ site( 'dev', { projectId: 'sdhq' } ), site( 'loose' ) ], projects );

	it( 'returns a project’s sites', () => {
		expect( sitesInContainer( grouped, 'sdhq' ).map( ( { id } ) => id ) ).toEqual( [ 'dev' ] );
	} );

	it( 'returns the ungrouped sites for null', () => {
		expect( sitesInContainer( grouped, null ).map( ( { id } ) => id ) ).toEqual( [ 'loose' ] );
	} );

	it( 'returns nothing for an unknown project', () => {
		expect( sitesInContainer( grouped, 'nope' ) ).toEqual( [] );
	} );
} );
