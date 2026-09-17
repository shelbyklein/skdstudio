import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SiteMenu from 'src/components/site-menu';
import { store } from 'src/stores';
import type { Project } from 'src/storage/storage-types';

const showProjectContextMenu = vi.fn();
const showSiteContextMenu = vi.fn();
const updateSitesSortOrder = vi.fn();
const setProjectCollapsed = vi.fn();
const renameProject = vi.fn();
const updateProjectsSortOrder = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: vi.fn(),
	getIpcApi: () => ( {
		showProjectContextMenu,
		showSiteContextMenu,
		showMessageBox: vi.fn().mockResolvedValue( { response: 0 } ),
	} ),
} ) );

vi.mock( 'src/stores/installed-apps-api', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useGetUserEditorQuery: () => ( { data: 'vscode' } ),
	useGetUserTerminalQuery: () => ( { data: 'terminal' } ),
} ) );

vi.mock( 'src/hooks/use-import-export', () => ( {
	useImportExport: () => ( { isSiteImporting: () => false, isSiteExporting: () => false } ),
} ) );

vi.mock( 'src/hooks/use-delete-site', () => ( {
	useDeleteSite: () => ( { handleDeleteSite: vi.fn() } ),
} ) );

vi.mock( 'src/lib/app-globals', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	isMac: () => true,
} ) );

vi.mock( 'src/modules/user-settings/lib/terminal', () => ( {
	getTerminalName: () => 'Terminal',
} ) );

vi.mock( 'src/hooks/use-content-tabs', () => ( {
	useContentTabs: () => ( { setSelectedTab: vi.fn() } ),
} ) );

let sites: SiteDetails[] = [];
let projects: Project[] = [];

vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		sites,
		selectedSite: undefined,
		setSelectedSiteId: vi.fn(),
		startServer: vi.fn(),
		stopServer: vi.fn(),
		setIsEditModalOpen: vi.fn(),
		copySite: vi.fn(),
		loadingServer: {},
		isSiteDeleting: () => false,
		updateSitesSortOrder,
	} ),
} ) );

vi.mock( 'src/modules/projects/hooks/use-projects', () => ( {
	useProjects: () => ( {
		projects,
		createProject: vi.fn(),
		renameProject,
		deleteProject: vi.fn(),
		setProjectCollapsed,
		updateProjectsSortOrder,
	} ),
} ) );

function site( id: string, extra: Partial< SiteDetails > = {} ): SiteDetails {
	return { id, name: id, path: `/sites/${ id }`, running: false, ...extra } as SiteDetails;
}

function renderMenu() {
	return render(
		<Provider store={ store }>
			<SiteMenu />
		</Provider>
	);
}

/** The `<li>` wrapping a site's name button. */
function rowFor( name: string ): HTMLElement {
	return screen.getByRole( 'button', { name } ).closest( 'li' )!;
}

beforeEach( () => {
	vi.clearAllMocks();
	window.ipcListener = { subscribe: vi.fn( () => vi.fn() ) } as never;
	sites = [];
	projects = [];
} );

describe( 'sidebar grouping', () => {
	it( 'lists ungrouped sites when there are no projects', async () => {
		sites = [ site( 'alpha' ), site( 'beta' ) ];

		renderMenu();

		expect( screen.getByRole( 'button', { name: 'alpha' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'beta' } ) ).toBeVisible();
		expect( screen.queryByRole( 'region' ) ).not.toBeInTheDocument();
	} );

	it( 'shows each project as a section holding its own sites', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [ site( 'dev', { projectId: 'sdhq' } ), site( 'loose' ) ];

		renderMenu();

		const section = screen.getByRole( 'region', { name: 'SDHQ' } );
		expect( within( section ).getByRole( 'button', { name: 'dev' } ) ).toBeVisible();
		expect( within( section ).queryByRole( 'button', { name: 'loose' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'loose' } ) ).toBeVisible();
	} );

	it( 'renders projects before the ungrouped sites', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [ site( 'loose' ), site( 'dev', { projectId: 'sdhq' } ) ];

		renderMenu();

		const order = screen
			.getAllByRole( 'button', { name: /^(dev|loose)$/ } )
			.map( ( button ) => button.textContent );
		expect( order ).toEqual( [ 'dev', 'loose' ] );
	} );

	it( 'hides the sites of a collapsed project but keeps its header', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000, collapsed: true } ];
		sites = [ site( 'dev', { projectId: 'sdhq' } ) ];

		renderMenu();

		expect( screen.getByRole( 'button', { name: /SDHQ/ } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'dev' } ) ).not.toBeInTheDocument();
	} );

	it( 'flags a collapsed project that still has something running', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000, collapsed: true } ];
		sites = [ site( 'dev', { projectId: 'sdhq', running: true } ) ];

		renderMenu();

		expect( screen.getByLabelText( 'SDHQ has a running site' ) ).toBeInTheDocument();
	} );

	it( 'shows a drop target in an empty project', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];

		renderMenu();

		const section = screen.getByRole( 'region', { name: 'SDHQ' } );
		expect( within( section ).getByText( 'Drop sites here' ) ).toBeVisible();
	} );

	it( 'boxes ungrouped sites under Uncategorized once a project exists', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [ site( 'dev', { projectId: 'sdhq' } ), site( 'loose' ) ];

		renderMenu();

		const section = screen.getByRole( 'region', { name: 'Uncategorized' } );
		expect( within( section ).getByRole( 'button', { name: 'loose' } ) ).toBeVisible();
		expect( within( section ).queryByRole( 'button', { name: 'dev' } ) ).not.toBeInTheDocument();
	} );

	it( 'leaves the plain list alone when there are no projects', () => {
		sites = [ site( 'loose' ) ];

		renderMenu();

		expect( screen.queryByRole( 'region', { name: 'Uncategorized' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'loose' } ) ).toBeVisible();
	} );

	it( 'keeps Uncategorized present as a drop target when everything is grouped', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [ site( 'dev', { projectId: 'sdhq' } ) ];

		renderMenu();

		const section = screen.getByRole( 'region', { name: 'Uncategorized' } );
		expect( within( section ).getByText( 'Drop sites here' ) ).toBeVisible();
	} );

	it( 'toggles a project from its header', async () => {
		const user = userEvent.setup();
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];

		renderMenu();
		await user.click( screen.getByRole( 'button', { name: /SDHQ/ } ) );

		expect( setProjectCollapsed ).toHaveBeenCalledWith( 'sdhq', true );
	} );

	it( 'passes the project list to the site context menu', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [ site( 'dev', { projectId: 'sdhq' } ) ];

		renderMenu();
		fireContextMenu( rowFor( 'dev' ) );

		expect( showSiteContextMenu ).toHaveBeenCalledWith(
			expect.objectContaining( {
				siteId: 'dev',
				projectId: 'sdhq',
				projects: [ { id: 'sdhq', name: 'SDHQ' } ],
			} )
		);
	} );
} );

describe( 'sidebar drag and drop', () => {
	it( 'moves a site into the project whose header it was dropped on', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [ site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ), site( 'loose' ) ];

		renderMenu();

		const header = screen.getByRole( 'button', { name: /SDHQ/ } ).parentElement!;
		fireDrag( rowFor( 'loose' ), header );

		expect( updateSitesSortOrder ).toHaveBeenCalledWith( expect.anything(), [
			{ siteId: 'dev', sortOrder: 1000, projectId: 'sdhq' },
			{ siteId: 'loose', sortOrder: 2000, projectId: 'sdhq' },
		] );
	} );

	it( 'inserts a site before the row it was dropped on', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [
			site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ),
			site( 'staging', { projectId: 'sdhq', sortOrder: 2000 } ),
			site( 'loose' ),
		];

		renderMenu();
		fireDrag( rowFor( 'loose' ), rowFor( 'staging' ) );

		expect( updateSitesSortOrder ).toHaveBeenCalledWith( expect.anything(), [
			{ siteId: 'dev', sortOrder: 1000, projectId: 'sdhq' },
			{ siteId: 'loose', sortOrder: 2000, projectId: 'sdhq' },
			{ siteId: 'staging', sortOrder: 3000, projectId: 'sdhq' },
		] );
	} );

	it( 'ungroups a site dropped on an empty project’s placeholder of another project', () => {
		projects = [ { id: 'sdhq', name: 'SDHQ', sortOrder: 1000 } ];
		sites = [ site( 'dev', { projectId: 'sdhq', sortOrder: 1000 } ) ];

		renderMenu();
		// The trailing drop zone of the ungrouped list.
		const dropZone = document.querySelector( 'ul > li.h-8:not([draggable])' )!;
		fireDrag( rowFor( 'dev' ), dropZone as HTMLElement );

		expect( updateSitesSortOrder ).toHaveBeenCalledWith( expect.anything(), [
			{ siteId: 'dev', sortOrder: 1000, projectId: null },
		] );
	} );

	it( 'reorders projects when a header is dropped on a header', () => {
		projects = [
			{ id: 'sdhq', name: 'SDHQ', sortOrder: 1000 },
			{ id: 'sisol', name: 'Sisol', sortOrder: 2000 },
		];

		renderMenu();
		const first = screen.getByRole( 'button', { name: /SDHQ/ } ).parentElement!;
		const second = screen.getByRole( 'button', { name: /Sisol/ } ).parentElement!;
		fireDrag( second, first );

		expect( updateProjectsSortOrder ).toHaveBeenCalledWith( [
			expect.objectContaining( { id: 'sisol' } ),
			expect.objectContaining( { id: 'sdhq' } ),
		] );
	} );

	it( 'does not write when a site is dropped on itself', () => {
		sites = [ site( 'alpha', { sortOrder: 1000 } ), site( 'beta', { sortOrder: 2000 } ) ];

		renderMenu();
		fireDrag( rowFor( 'alpha' ), rowFor( 'alpha' ) );

		expect( updateSitesSortOrder ).not.toHaveBeenCalled();
	} );
} );

function fireContextMenu( element: Element ) {
	fireEvent.contextMenu( element );
}

/**
 * Runs a full dragstart → dragover → drop sequence. jsdom has no DataTransfer, and the component
 * only writes `effectAllowed` / `dropEffect` to it, so a plain object stands in.
 */
function fireDrag( from: Element, to: Element ) {
	const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
	fireEvent.dragStart( from, { dataTransfer } );
	fireEvent.dragOver( to, { dataTransfer } );
	fireEvent.drop( to, { dataTransfer } );
}
