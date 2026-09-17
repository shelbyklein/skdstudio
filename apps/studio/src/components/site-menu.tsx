import { speak } from '@wordpress/a11y';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XDebugIcon } from 'src/components/icons/xdebug-icon';
import { Tooltip } from 'src/components/tooltip';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getFileManagerLabel } from 'src/lib/file-manager';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ProjectSection } from 'src/modules/projects/components/project-section';
import { useProjects } from 'src/modules/projects/hooks/use-projects';
import { groupSites } from 'src/modules/projects/lib/group-sites';
import { planProjectMove, planSiteMove, type DropTarget } from 'src/modules/projects/lib/plan-move';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import type { Project } from 'src/storage/storage-types';

/** Stands in for "no project" in the sidebar's Uncategorized section. Never stored. */
const UNCATEGORIZED_ID = '__uncategorized__';

/** What the pointer is currently carrying. HTML5 DnD won't let us read dataTransfer on dragover. */
type DragPayload = { kind: 'site'; siteId: string } | { kind: 'project'; projectId: string };

/** Where the drop indicator is showing. */
type DropHint =
	| { kind: 'site'; siteId: string }
	| { kind: 'container'; projectId: string | null }
	| { kind: 'project'; projectId: string };

interface SiteMenuProps {
	className?: string;
}

function ButtonToRun( site: SiteDetails ) {
	const { running, id, name, enableXdebug } = site;
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const siteStartedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site started.' ),
		name
	);
	const siteStoppedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site stopped.' ),
		name
	);

	useEffect( () => {
		speak( running ? siteStartedMessage : siteStoppedMessage );
	}, [ running, siteStartedMessage, siteStoppedMessage ] );

	const classCircle = `rounded-full`;
	const triangle = (
		<svg
			aria-hidden="true"
			width="8"
			height="10"
			viewBox="0 0 8 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="rtl:scale-x-[-1]"
		>
			<path
				d="M0.25 0.854923C0.25 0.663717 0.455914 0.543288 0.622565 0.63703L7.17821 4.32458C7.33948 4.41529 7.34975 4.64367 7.19728 4.74849L0.641632 9.2555C0.475757 9.36953 0.25 9.25078 0.25 9.04949V0.854923Z"
				fill="#1ED15A"
				stroke="#00BA37"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const rectangle = (
		<svg
			aria-hidden="true"
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M0.25 2C0.25 1.0335 1.0335 0.25 2 0.25H8C8.9665 0.25 9.75 1.0335 9.75 2V8C9.75 8.9665 8.9665 9.75 8 9.75H2C1.0335 9.75 0.25 8.9665 0.25 8V2Z"
				fill="#FF8085"
				stroke="#F86368"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const tooltipText = loadingServer[ id ]
		? __( 'Starting' )
		: running
		? __( 'Stop site' )
		: __( 'Start site' );

	return (
		<Tooltip text={ tooltipText }>
			<button
				type="button"
				aria-disabled={ loadingServer[ id ] }
				onClick={ () => {
					if ( loadingServer[ id ] ) {
						return;
					}
					return running ? stopServer( id ) : startServer( site );
				} }
				className="w-7 h-8 rounded-tr rounded-br group grid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				aria-label={ sprintf( running ? __( 'stop %s site' ) : __( 'start %s site' ), name ) }
			>
				{ /* Circle or Xdebug icon */ }
				{ enableXdebug ? (
					<div
						className={ cx(
							'transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0',
							'row-start-1 col-start-1 place-self-center',
							loadingServer[ id ] && 'animate-pulse duration-100'
						) }
					>
						<XDebugIcon greyed={ ! running && ! loadingServer[ id ] } />
					</div>
				) : (
					<div
						className={ cx(
							'w-2.5 h-2.5 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 border-[0.5px]',
							'row-start-1 col-start-1 place-self-center',
							classCircle,
							loadingServer[ id ] &&
								'animate-pulse border-a8c-green-20/50 bg-a8c-green-20/50 duration-100',
							running && 'border-a8c-green-20 bg-a8c-green-20 duration-100',
							! running && ! loadingServer[ id ] && 'border-[#ffffff19] bg-[#ffffff26]'
						) }
					>
						&nbsp;
					</div>
				) }
				{ /* Shapes on hover */ }
				{ ! loadingServer[ id ] && (
					<div
						className={ cx(
							'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
							'row-start-1 col-start-1 place-self-center'
						) }
					>
						{ running ? rectangle : triangle }
					</div>
				) }
			</button>
		</Tooltip>
	);
}
function SiteItem( {
	site,
	projects,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
	isDragOver,
	isNested = false,
}: {
	site: SiteDetails;
	projects: Project[];
	onDragStart: ( e: React.DragEvent, siteId: string ) => void;
	onDragOver: ( e: React.DragEvent, siteId: string ) => void;
	onDrop: ( e: React.DragEvent, siteId: string ) => void;
	onDragEnd: () => void;
	isDragOver: boolean;
	/** Inside a project box, which supplies its own inset and indents its rows. */
	isNested?: boolean;
} ) {
	const { sites, selectedSite, setSelectedSiteId, loadingServer, isSiteDeleting } =
		useSiteDetails();
	const isSelected = site === selectedSite;
	const { isSiteImporting, isSiteExporting } = useImportExport();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const isImporting = isSiteImporting( site.id );
	const isExporting = isSiteExporting( site.id );
	const isDeleting = isSiteDeleting( site.id );
	const showSpinner = site.isAddingSite || isImporting || isExporting || isDeleting;

	let tooltipText: string;
	if ( site.isAddingSite ) {
		tooltipText = __( 'Adding' );
	} else if ( isImporting ) {
		tooltipText = __( 'Importing' );
	} else {
		tooltipText = __( 'Loading' );
	}

	const handleContextMenu = ( e: React.MouseEvent ) => {
		e.preventDefault();
		const ipcApi = getIpcApi();
		const isLoading = loadingServer[ site.id ] || false;
		const isAddingSite = site.isAddingSite || false;
		const isAnySiteAdding = sites.some( ( s ) => s.isAddingSite );
		const finderLabel = getFileManagerLabel();
		const editorLabel =
			editor && supportedEditorConfig[ editor ] ? supportedEditorConfig[ editor ].label() : null;
		const terminalLabel = getTerminalName( terminal );

		ipcApi.showSiteContextMenu( {
			siteId: site.id,
			isRunning: site.running,
			isLoading,
			isAddingSite,
			isAnySiteAdding,
			finderLabel,
			editorLabel,
			terminalLabel,
			projects: projects.map( ( { id, name } ) => ( { id, name } ) ),
			projectId: site.projectId,
		} );
	};

	return (
		<li
			className={ cx(
				'flex flex-row h-8 hover:bg-[#ffffff0C] rounded transition-all items-center',
				isNested ? 'ms-3 me-1' : cx( 'min-w-[168px] ms-1', isMac() ? 'me-5' : 'me-4' ),
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]',
				isDragOver && 'bg-[#ffffff26]'
			) }
			onContextMenu={ handleContextMenu }
			draggable
			onDragStart={ ( e ) => onDragStart( e, site.id ) }
			onDragOver={ ( e ) => onDragOver( e, site.id ) }
			onDrop={ ( e ) => onDrop( e, site.id ) }
			onDragEnd={ onDragEnd }
		>
			<button
				type="button"
				className="p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				onClick={ () => {
					setSelectedSiteId( site.id );
				} }
			>
				{ site.name }
			</button>
			{ showSpinner ? (
				<Tooltip text={ tooltipText }>
					<div className="grid place-items-center">
						<Spinner className="!w-2.5 !h-2.5 !mt-0 !mr-2 [&>circle]:stroke-a8c-gray-70" />
					</div>
				</Tooltip>
			) : (
				<ButtonToRun { ...site } />
			) }
		</li>
	);
}

export default function SiteMenu( { className }: SiteMenuProps ) {
	const {
		sites,
		selectedSite,
		setSelectedSiteId,
		startServer,
		stopServer,
		setIsEditModalOpen,
		copySite,
		updateSitesSortOrder,
	} = useSiteDetails();
	const {
		projects,
		createProject,
		renameProject,
		deleteProject,
		setProjectCollapsed,
		updateProjectsSortOrder,
	} = useProjects();
	const { setSelectedTab } = useContentTabs();
	const { handleDeleteSite } = useDeleteSite();
	const { data: editor } = useGetUserEditorQuery();
	const [ dragPayload, setDragPayload ] = useState< DragPayload | null >( null );
	const [ dropHint, setDropHint ] = useState< DropHint | null >( null );
	const [ renamingProjectId, setRenamingProjectId ] = useState< string | null >( null );
	// Not persisted: Uncategorized is not a stored project, and a collapsed state that survives
	// restarts is not worth a storage field here.
	const [ isUncategorizedCollapsed, setIsUncategorizedCollapsed ] = useState( false );

	const grouped = useMemo( () => groupSites( sites, projects ), [ sites, projects ] );

	const moveSite = useCallback(
		async ( siteId: string, target: DropTarget ) => {
			const updates = planSiteMove( sites, projects, siteId, target );
			if ( ! updates.length ) {
				return;
			}

			// `updateSitesSortOrder` expects the full list in its new order, and does the
			// optimistic local update. Rebuild that list with the moves applied.
			const moved = new Map( updates.map( ( update ) => [ update.siteId, update ] ) );
			const reordered = sites.map( ( site ) => {
				const update = moved.get( site.id );
				return update
					? { ...site, sortOrder: update.sortOrder, projectId: update.projectId ?? undefined }
					: site;
			} );

			await updateSitesSortOrder( reordered, updates );

			const site = sites.find( ( { id } ) => id === siteId );
			const destination = updates[ 0 ].projectId;
			const project = projects.find( ( { id } ) => id === destination );
			if ( site && destination !== ( site.projectId ?? null ) ) {
				speak(
					project
						? sprintf(
								/* translators: 1: site name, 2: project name. */
								__( '%1$s moved to %2$s.' ),
								site.name,
								project.name
						  )
						: sprintf(
								/* translators: %s is the site name. */
								__( '%s removed from its project.' ),
								site.name
						  )
				);
			}
		},
		[ sites, projects, updateSitesSortOrder ]
	);

	const handleNewProjectForSite = useCallback(
		async ( siteId: string ) => {
			const project = await createProject( __( 'New project' ) );
			if ( ! project ) {
				return;
			}
			await moveSite( siteId, { type: 'container', projectId: project.id } );
			setRenamingProjectId( project.id );
		},
		[ createProject, moveSite ]
	);

	const handleDeleteProject = useCallback(
		async ( project: Project ) => {
			const siteCount =
				grouped.projects.find( ( { project: { id } } ) => id === project.id )?.sites.length ?? 0;

			if ( siteCount > 0 ) {
				const { response } = await getIpcApi().showMessageBox( {
					type: 'warning',
					message: sprintf(
						/* translators: %s is the project name. */
						__( 'Delete %s' ),
						project.name
					),
					detail: __(
						'The sites in this project are kept — they move back to the ungrouped list at the bottom of the sidebar.'
					),
					buttons: [ __( 'Delete project' ), __( 'Cancel' ) ],
					cancelId: 1,
				} );
				if ( response !== 0 ) {
					return;
				}
			}

			await deleteProject( project.id );
		},
		[ deleteProject, grouped ]
	);

	// Drag and drop. Every move below is also reachable from the context menus, because HTML5
	// drag and drop is pointer-only.

	const handleSiteDragStart = ( e: React.DragEvent, siteId: string ) => {
		setDragPayload( { kind: 'site', siteId } );
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleProjectDragStart = ( e: React.DragEvent, projectId: string ) => {
		setDragPayload( { kind: 'project', projectId } );
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDragOver = ( e: React.DragEvent, hint: DropHint ) => {
		if ( ! dragPayload ) {
			return;
		}
		// A project can only be dropped on another project header.
		if ( dragPayload.kind === 'project' && hint.kind !== 'project' ) {
			return;
		}
		if ( dragPayload.kind === 'site' && hint.kind === 'project' ) {
			// Dragging a site onto a header means "put it in there", not "reorder projects".
			hint = { kind: 'container', projectId: hint.projectId };
		}
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
		setDropHint( hint );
	};

	const handleDrop = ( e: React.DragEvent, hint: DropHint ) => {
		e.preventDefault();
		e.stopPropagation();
		const payload = dragPayload;
		setDropHint( null );
		setDragPayload( null );
		if ( ! payload ) {
			return;
		}

		if ( payload.kind === 'project' ) {
			if ( hint.kind === 'project' && hint.projectId !== payload.projectId ) {
				void updateProjectsSortOrder(
					planProjectMove( projects, payload.projectId, hint.projectId )
				);
			}
			return;
		}

		if ( hint.kind === 'site' ) {
			void moveSite( payload.siteId, { type: 'before-site', siteId: hint.siteId } );
			return;
		}

		const projectId = hint.kind === 'project' ? hint.projectId : hint.projectId;
		// Dropping onto a collapsed project should show where the site landed.
		const project = projects.find( ( { id } ) => id === projectId );
		if ( project?.collapsed ) {
			void setProjectCollapsed( project.id, false );
		}
		void moveSite( payload.siteId, { type: 'container', projectId } );
	};

	const handleDragEnd = () => {
		setDragPayload( null );
		setDropHint( null );
	};

	// Selecting a site inside a collapsed project — from the Manage tab, a context menu or the
	// running-sites strip — must not leave it selected but invisible.
	//
	// This runs on a *change of selection* only. Watching the project list too would make a project
	// holding the selected site impossible to collapse: it would spring open again on the same
	// click. Collapsing a project you are working in is allowed, and stays collapsed.
	const expandForSelection = useRef( { projects, setProjectCollapsed } );
	useEffect( () => {
		expandForSelection.current = { projects, setProjectCollapsed };
	} );
	// Whether a selection has been seen yet this session. The first one is whatever the app
	// restored at launch, and acting on it would re-open a project the user left collapsed.
	const hasSeenSelection = useRef( false );
	const selectedProjectId = selectedSite?.projectId;
	useEffect( () => {
		if ( ! selectedSite?.id ) {
			return;
		}
		const isFirst = ! hasSeenSelection.current;
		hasSeenSelection.current = true;
		if ( isFirst || ! selectedProjectId ) {
			return;
		}
		const { projects: current, setProjectCollapsed: collapse } = expandForSelection.current;
		const project = current.find( ( { id } ) => id === selectedProjectId );
		if ( project?.collapsed ) {
			void collapse( project.id, false );
		}
		// Deliberately keyed on the selected site alone; see above.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ selectedSite?.id ] );

	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'project-context-menu-action',
			async ( _, actionData: { action: string; projectId: string } ) => {
				const project = projects.find( ( { id } ) => id === actionData.projectId );
				if ( ! project ) {
					return;
				}

				switch ( actionData.action ) {
					case 'collapse':
						await setProjectCollapsed( project.id, true );
						break;
					case 'expand':
						await setProjectCollapsed( project.id, false );
						break;
					case 'rename':
						setRenamingProjectId( project.id );
						break;
					case 'delete':
						await handleDeleteProject( project );
						break;
				}
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, [ projects, setProjectCollapsed, handleDeleteProject ] );

	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'site-context-menu-action',
			async ( _, actionData: { action: string; siteId: string; projectId?: string | null } ) => {
				const site = sites.find( ( site ) => site.id === actionData.siteId );
				if ( ! site ) {
					return;
				}

				const ipcApi = getIpcApi();
				switch ( actionData.action ) {
					case 'start':
						void startServer( site );
						break;
					case 'stop':
						void stopServer( site.id );
						break;
					case 'open-site':
						if ( ! site.running ) {
							await startServer( site );
						}
						ipcApi.openSiteURL( site.id, '', { autoLogin: false } );
						break;
					case 'open-admin':
						if ( ! site.running ) {
							await startServer( site );
						}
						ipcApi.openSiteURL( site.id, '/wp-admin/' );
						break;
					case 'open-finder':
						ipcApi.openLocalPath( site.path );
						break;
					case 'open-editor':
						if ( editor ) {
							void ipcApi.openAppAtPath( editor, site.path );
						}
						break;
					case 'open-terminal':
						void ( async () => {
							try {
								await ipcApi.openTerminalAtPath( site.path );
							} catch ( error ) {
								console.error( error );
								alert( __( 'Could not open the terminal.' ) );
							}
						} )();
						break;
					case 'edit-site':
						if ( site.id !== selectedSite?.id ) {
							setSelectedSiteId( site.id );
						}
						setSelectedTab( 'settings' );
						setIsEditModalOpen( true );
						break;
					case 'copy-site':
						void ( async () => {
							try {
								await copySite( site.id );
							} catch ( error ) {
								console.error( error );
							}
						} )();
						break;
					case 'move-to-project':
						await moveSite( site.id, {
							type: 'container',
							projectId: actionData.projectId ?? null,
						} );
						break;
					case 'new-project':
						await handleNewProjectForSite( site.id );
						break;
					case 'delete':
						await handleDeleteSite( site.id, site.name );
						break;
				}
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, [
		sites,
		editor,
		selectedSite?.id,
		setSelectedTab,
		setIsEditModalOpen,
		setSelectedSiteId,
		startServer,
		stopServer,
		copySite,
		handleDeleteSite,
		moveSite,
		handleNewProjectForSite,
	] );

	const renderSites = ( list: SiteDetails[], isNested = false ) =>
		list.map( ( site ) => (
			<SiteItem
				key={ site.id }
				site={ site }
				projects={ projects }
				isNested={ isNested }
				onDragStart={ handleSiteDragStart }
				onDragOver={ ( e, siteId ) => handleDragOver( e, { kind: 'site', siteId } ) }
				onDrop={ ( e, siteId ) => handleDrop( e, { kind: 'site', siteId } ) }
				onDragEnd={ handleDragEnd }
				isDragOver={ dropHint?.kind === 'site' && dropHint.siteId === site.id }
			/>
		) );

	return (
		<nav
			aria-label={ __( 'Sites' ) }
			style={ {
				scrollbarGutter: 'stable',
			} }
			className={ cx(
				'w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pb-4',
				className
			) }
		>
			<div className="pt-px">
				{ grouped.projects.map( ( { project, sites: projectSites } ) => (
					<ProjectSection
						key={ project.id }
						project={ project }
						siteCount={ projectSites.length }
						hasRunningSite={ projectSites.some( ( site ) => site.running ) }
						isRenaming={ renamingProjectId === project.id }
						isDragOver={
							( dropHint?.kind === 'container' && dropHint.projectId === project.id ) ||
							( dropHint?.kind === 'project' && dropHint.projectId === project.id )
						}
						onToggleCollapsed={ () => void setProjectCollapsed( project.id, ! project.collapsed ) }
						onRename={ ( name ) => {
							setRenamingProjectId( null );
							void renameProject( project.id, name );
						} }
						onRenameCancel={ () => setRenamingProjectId( null ) }
						onContextMenu={ ( e ) => {
							e.preventDefault();
							getIpcApi().showProjectContextMenu( {
								projectId: project.id,
								isCollapsed: Boolean( project.collapsed ),
								isEmpty: projectSites.length === 0,
							} );
						} }
						onHeaderDragStart={ ( e ) => handleProjectDragStart( e, project.id ) }
						onHeaderDragOver={ ( e ) =>
							handleDragOver( e, { kind: 'project', projectId: project.id } )
						}
						onHeaderDrop={ ( e ) => handleDrop( e, { kind: 'project', projectId: project.id } ) }
						onDragEnd={ handleDragEnd }
					>
						<ul>
							{ renderSites( projectSites, true ) }
							{ projectSites.length === 0 && (
								<li
									className={ cx(
										'h-8 ms-3 me-1 rounded flex items-center px-2 text-xs text-a8c-gray-50/70 border border-dashed border-white/10',
										dropHint?.kind === 'container' &&
											dropHint.projectId === project.id &&
											'bg-[#ffffff19]'
									) }
									onDragOver={ ( e ) =>
										handleDragOver( e, { kind: 'container', projectId: project.id } )
									}
									onDrop={ ( e ) => handleDrop( e, { kind: 'container', projectId: project.id } ) }
								>
									{ __( 'Drop sites here' ) }
								</li>
							) }
						</ul>
					</ProjectSection>
				) ) }

				{ /* Once projects exist, everything sits in a box — loose rows beneath them read as
				     leftovers. Uncategorized is not a project: it cannot be renamed, deleted or
				     reordered, and it is always present so there is somewhere to drag a site out to.
				     With no projects at all, the plain list is left alone. */ }
				{ projects.length > 0 ? (
					<ProjectSection
						project={ {
							id: UNCATEGORIZED_ID,
							name: __( 'Uncategorized' ),
							sortOrder: 0,
							collapsed: isUncategorizedCollapsed,
						} }
						isEditable={ false }
						siteCount={ grouped.ungrouped.length }
						hasRunningSite={ grouped.ungrouped.some( ( site ) => site.running ) }
						isRenaming={ false }
						isDragOver={ dropHint?.kind === 'container' && dropHint.projectId === null }
						onToggleCollapsed={ () => setIsUncategorizedCollapsed( ( current ) => ! current ) }
						onRename={ () => undefined }
						onRenameCancel={ () => undefined }
						onHeaderDragOver={ ( e ) =>
							handleDragOver( e, { kind: 'container', projectId: null } )
						}
						onHeaderDrop={ ( e ) => handleDrop( e, { kind: 'container', projectId: null } ) }
						onDragEnd={ handleDragEnd }
					>
						<ul>
							{ renderSites( grouped.ungrouped, true ) }
							{ grouped.ungrouped.length === 0 && (
								<li
									className={ cx(
										'h-8 ms-3 me-1 rounded flex items-center px-2 text-xs text-a8c-gray-50/70 border border-dashed border-white/10',
										dropHint?.kind === 'container' &&
											dropHint.projectId === null &&
											'bg-[#ffffff19]'
									) }
									onDragOver={ ( e ) =>
										handleDragOver( e, { kind: 'container', projectId: null } )
									}
									onDrop={ ( e ) => handleDrop( e, { kind: 'container', projectId: null } ) }
								>
									{ __( 'Drop sites here' ) }
								</li>
							) }
						</ul>
					</ProjectSection>
				) : (
					<ul
						onDragOver={ ( e ) => handleDragOver( e, { kind: 'container', projectId: null } ) }
						onDrop={ ( e ) => handleDrop( e, { kind: 'container', projectId: null } ) }
					>
						{ renderSites( grouped.ungrouped ) }
						<li
							className="h-8"
							onDragOver={ ( e ) => handleDragOver( e, { kind: 'container', projectId: null } ) }
							onDrop={ ( e ) => handleDrop( e, { kind: 'container', projectId: null } ) }
						/>
					</ul>
				) }
			</div>
		</nav>
	);
}
