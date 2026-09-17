/**
 * The sidebar's project list.
 *
 * Mutations update local state first and persist second, the same optimistic pattern
 * `updateSitesSortOrder` uses — a folder that lags a frame behind the pointer feels broken during
 * a drag. A failed write is logged and the list reloaded, so the UI falls back to the truth on disk
 * rather than silently drifting from it.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { Project } from 'src/storage/storage-types';

interface ProjectsContext {
	projects: Project[];
	createProject: ( name: string ) => Promise< Project | undefined >;
	renameProject: ( projectId: string, name: string ) => Promise< void >;
	deleteProject: ( projectId: string ) => Promise< void >;
	setProjectCollapsed: ( projectId: string, collapsed: boolean ) => Promise< void >;
	updateProjectsSortOrder: ( projects: Project[] ) => Promise< void >;
	reloadProjects: () => Promise< void >;
}

const defaultContext: ProjectsContext = {
	projects: [],
	createProject: async () => undefined,
	renameProject: async () => undefined,
	deleteProject: async () => undefined,
	setProjectCollapsed: async () => undefined,
	updateProjectsSortOrder: async () => undefined,
	reloadProjects: async () => undefined,
};

const projectsContext = createContext< ProjectsContext >( defaultContext );

export function useProjects() {
	return useContext( projectsContext );
}

export function ProjectsProvider( { children }: { children: React.ReactNode } ) {
	const [ projects, setProjects ] = useState< Project[] >( [] );

	const reloadProjects = useCallback( async () => {
		try {
			setProjects( await getIpcApi().getProjects() );
		} catch ( error ) {
			console.error( 'Failed to load projects:', error );
		}
	}, [] );

	useEffect( () => {
		void reloadProjects();
	}, [ reloadProjects ] );

	const createProject = useCallback( async ( name: string ) => {
		try {
			const project = await getIpcApi().createProject( name );
			setProjects( ( current ) => [ ...current, project ] );
			return project;
		} catch ( error ) {
			console.error( 'Failed to create project:', error );
			return undefined;
		}
	}, [] );

	const renameProject = useCallback(
		async ( projectId: string, name: string ) => {
			setProjects( ( current ) =>
				current.map( ( project ) => ( project.id === projectId ? { ...project, name } : project ) )
			);
			try {
				await getIpcApi().renameProject( projectId, name );
			} catch ( error ) {
				console.error( 'Failed to rename project:', error );
				await reloadProjects();
			}
		},
		[ reloadProjects ]
	);

	const deleteProject = useCallback(
		async ( projectId: string ) => {
			setProjects( ( current ) => current.filter( ( { id } ) => id !== projectId ) );
			try {
				await getIpcApi().deleteProject( projectId );
			} catch ( error ) {
				console.error( 'Failed to delete project:', error );
				await reloadProjects();
			}
		},
		[ reloadProjects ]
	);

	const setProjectCollapsed = useCallback( async ( projectId: string, collapsed: boolean ) => {
		setProjects( ( current ) =>
			current.map( ( project ) =>
				project.id === projectId ? { ...project, collapsed } : project
			)
		);
		try {
			await getIpcApi().setProjectCollapsed( projectId, collapsed );
		} catch ( error ) {
			console.error( 'Failed to save the project state:', error );
		}
	}, [] );

	const updateProjectsSortOrder = useCallback(
		async ( ordered: Project[] ) => {
			const updates = ordered.map( ( project, index ) => ( {
				projectId: project.id,
				sortOrder: ( index + 1 ) * 1000,
			} ) );
			setProjects(
				ordered.map( ( project, index ) => ( {
					...project,
					sortOrder: updates[ index ].sortOrder,
				} ) )
			);
			try {
				await getIpcApi().updateProjectsSortOrder( updates );
			} catch ( error ) {
				console.error( 'Failed to save the project order:', error );
				await reloadProjects();
			}
		},
		[ reloadProjects ]
	);

	return (
		<projectsContext.Provider
			value={ {
				projects,
				createProject,
				renameProject,
				deleteProject,
				setProjectCollapsed,
				updateProjectsSortOrder,
				reloadProjects,
			} }
		>
			{ children }
		</projectsContext.Provider>
	);
}
