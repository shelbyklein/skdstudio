/**
 * Turns a drop into the `updateSitesSortOrder` payload it implies.
 *
 * Kept free of React so the awkward part — where a site lands when it crosses containers — can be
 * tested directly. Only the destination container is renumbered: pulling a site out of a list
 * leaves the rest in order, so rewriting the source would be churn for no gain.
 */
import {
	groupSites,
	sitesInContainer,
	type GroupedSites,
} from 'src/modules/projects/lib/group-sites';
import type { Project } from 'src/storage/storage-types';

export type DropTarget =
	/** Insert before this site, in whatever container that site is in. */
	| { type: 'before-site'; siteId: string }
	/** Append to this container. `null` is the ungrouped list. */
	| { type: 'container'; projectId: string | null };

export interface SiteOrderUpdate {
	siteId: string;
	sortOrder: number;
	projectId: string | null;
}

const SORT_ORDER_STEP = 1000;

function containerOf( grouped: GroupedSites, siteId: string ): string | null {
	const owner = grouped.projects.find( ( { sites } ) =>
		sites.some( ( site ) => site.id === siteId )
	);
	return owner?.project.id ?? null;
}

/**
 * Returns the writes a move needs, or an empty list when nothing would change — dropping a site on
 * itself, or back where it already sits.
 */
export function planSiteMove(
	sites: SiteDetails[],
	projects: Project[],
	siteId: string,
	target: DropTarget
): SiteOrderUpdate[] {
	if ( target.type === 'before-site' && target.siteId === siteId ) {
		return [];
	}

	const grouped = groupSites( sites, projects );
	const from = containerOf( grouped, siteId );
	const to = target.type === 'container' ? target.projectId : containerOf( grouped, target.siteId );

	const destination = sitesInContainer( grouped, to ).filter( ( site ) => site.id !== siteId );
	const moved = sites.find( ( site ) => site.id === siteId );
	if ( ! moved ) {
		return [];
	}

	const insertAt =
		target.type === 'before-site'
			? destination.findIndex( ( site ) => site.id === target.siteId )
			: destination.length;
	const at = insertAt === -1 ? destination.length : insertAt;

	const ordered = [ ...destination.slice( 0, at ), moved, ...destination.slice( at ) ];

	if ( from === to ) {
		const current = sitesInContainer( grouped, to );
		const unchanged =
			current.length === ordered.length &&
			current.every( ( site, index ) => site.id === ordered[ index ].id );
		if ( unchanged ) {
			return [];
		}
	}

	return ordered.map( ( site, index ) => ( {
		siteId: site.id,
		sortOrder: ( index + 1 ) * SORT_ORDER_STEP,
		projectId: to,
	} ) );
}

/** The project list reordered by dropping one project before another. */
export function planProjectMove(
	projects: Project[],
	projectId: string,
	beforeProjectId: string
): Project[] {
	if ( projectId === beforeProjectId ) {
		return projects;
	}

	const ordered = [ ...projects ].sort( ( a, b ) => a.sortOrder - b.sortOrder );
	const moved = ordered.find( ( { id } ) => id === projectId );
	if ( ! moved ) {
		return projects;
	}

	const without = ordered.filter( ( { id } ) => id !== projectId );
	const at = without.findIndex( ( { id } ) => id === beforeProjectId );
	if ( at === -1 ) {
		return projects;
	}

	return [ ...without.slice( 0, at ), moved, ...without.slice( at ) ];
}
