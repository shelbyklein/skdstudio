/**
 * Projects: the sidebar folders that sites sit in.
 *
 * Everything here reads and writes `app.json`, because a project is a desktop-only concept — the
 * CLI never sees one, the same way it no longer sees `autoStart`. Every write takes the appdata
 * lock for its whole read-modify-write, so two rapid drags can't interleave and lose one.
 */
import { randomUUID } from 'node:crypto';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { IpcMainInvokeEvent } from 'electron';
import type { Project, UserData } from 'src/storage/storage-types';

const SORT_ORDER_STEP = 1000;

function bySortOrder( a: Project, b: Project ): number {
	return a.sortOrder - b.sortOrder;
}

function sortedProjects( userData: UserData ): Project[] {
	return [ ...( userData.projects ?? [] ) ].sort( bySortOrder );
}

/** Runs `mutate` against the stored data under the appdata lock, then persists the result. */
async function updateUserData< T >( mutate: ( userData: UserData ) => T ): Promise< T > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const result = mutate( userData );
		await saveUserData( userData );
		return result;
	} finally {
		await unlockAppdata();
	}
}

export async function getProjects( _event?: IpcMainInvokeEvent ): Promise< Project[] > {
	return sortedProjects( await loadUserData() );
}

export async function createProject(
	_event: IpcMainInvokeEvent,
	name: string
): Promise< Project > {
	const trimmed = name.trim();
	if ( ! trimmed ) {
		throw new Error( 'A project needs a name.' );
	}

	return updateUserData( ( userData ) => {
		const projects = sortedProjects( userData );
		const project: Project = {
			id: randomUUID(),
			name: trimmed,
			sortOrder: ( projects.length + 1 ) * SORT_ORDER_STEP,
		};
		userData.projects = [ ...projects, project ];
		return project;
	} );
}

export async function renameProject(
	_event: IpcMainInvokeEvent,
	projectId: string,
	name: string
): Promise< void > {
	const trimmed = name.trim();
	if ( ! trimmed ) {
		throw new Error( 'A project needs a name.' );
	}

	await updateUserData( ( userData ) => {
		const project = userData.projects?.find( ( { id } ) => id === projectId );
		if ( project ) {
			project.name = trimmed;
		}
	} );
}

/**
 * Removes a project and ungroups the sites that were in it.
 *
 * Deleting a folder must never delete what it holds, so the sites keep every other piece of their
 * metadata and simply lose their `projectId`.
 */
export async function deleteProject(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< void > {
	await updateUserData( ( userData ) => {
		userData.projects = ( userData.projects ?? [] ).filter( ( { id } ) => id !== projectId );

		for ( const metadata of Object.values( userData.siteMetadata ) ) {
			if ( metadata.projectId === projectId ) {
				delete metadata.projectId;
			}
		}
	} );
}

export async function setProjectCollapsed(
	_event: IpcMainInvokeEvent,
	projectId: string,
	collapsed: boolean
): Promise< void > {
	await updateUserData( ( userData ) => {
		const project = userData.projects?.find( ( { id } ) => id === projectId );
		if ( project ) {
			project.collapsed = collapsed;
		}
	} );
}

export async function updateProjectsSortOrder(
	_event: IpcMainInvokeEvent,
	updates: { projectId: string; sortOrder: number }[]
): Promise< void > {
	await updateUserData( ( userData ) => {
		for ( const { projectId, sortOrder } of updates ) {
			const project = userData.projects?.find( ( { id } ) => id === projectId );
			if ( project ) {
				project.sortOrder = sortOrder;
			}
		}
	} );
}

/**
 * Puts one site in a project, or takes it out with `null`.
 *
 * Separate from `updateSitesSortOrder` because assigning a brand-new site has no ordering to
 * express: it lands at the end of whatever it joins, which is where the next unsorted thing goes.
 */
export async function setSiteProject(
	_event: IpcMainInvokeEvent,
	siteId: string,
	projectId: string | null
): Promise< void > {
	await updateUserData( ( userData ) => {
		const metadata = { ...userData.siteMetadata[ siteId ] };
		if ( projectId === null ) {
			delete metadata.projectId;
		} else {
			metadata.projectId = projectId;
		}
		userData.siteMetadata[ siteId ] = metadata;
	} );
}
