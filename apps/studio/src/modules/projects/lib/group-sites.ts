/**
 * Arranges a flat site list into the sidebar's shape: the projects in order, each with its own
 * sites, then everything ungrouped.
 *
 * `sortOrder` orders a site within its container, so two sites in different projects may share a
 * value. A `projectId` naming no project is folded into the ungrouped list rather than treated as
 * an error, so a half-written `app.json` still shows every site.
 */
import type { Project } from 'src/storage/storage-types';

export interface GroupedProject {
	project: Project;
	sites: SiteDetails[];
}

export interface GroupedSites {
	projects: GroupedProject[];
	ungrouped: SiteDetails[];
}

function bySortOrder( a: { sortOrder?: number }, b: { sortOrder?: number } ): number {
	return ( a.sortOrder ?? 0 ) - ( b.sortOrder ?? 0 );
}

export function groupSites( sites: SiteDetails[], projects: Project[] ): GroupedSites {
	const ordered = [ ...projects ].sort( bySortOrder );
	const known = new Set( ordered.map( ( { id } ) => id ) );
	const byProject = new Map< string, SiteDetails[] >( ordered.map( ( { id } ) => [ id, [] ] ) );
	const ungrouped: SiteDetails[] = [];

	for ( const site of sites ) {
		const bucket =
			site.projectId && known.has( site.projectId ) ? byProject.get( site.projectId ) : undefined;
		( bucket ?? ungrouped ).push( site );
	}

	return {
		projects: ordered.map( ( project ) => ( {
			project,
			sites: ( byProject.get( project.id ) ?? [] ).sort( bySortOrder ),
		} ) ),
		ungrouped: ungrouped.sort( bySortOrder ),
	};
}

/** The sites of one container, in order — the list a drop recomputes positions against. */
export function sitesInContainer( grouped: GroupedSites, projectId: string | null ): SiteDetails[] {
	if ( projectId === null ) {
		return grouped.ungrouped;
	}
	return grouped.projects.find( ( { project } ) => project.id === projectId )?.sites ?? [];
}
