import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi, type Mock } from 'vitest';
import App from 'src/components/app';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { createTestStore } from 'src/lib/test-utils';

vi.mock( 'src/index.css', () => ( {} ) );
vi.mock( 'src/components/dot-grid', () => ( {
	DotGrid: () => null,
} ) );
vi.mock( 'src/hooks/use-site-details' );

vi.mock( 'src/lib/app-globals', async () => {
	const actual = await vi.importActual( '../../lib/app-globals' );
	return {
		...actual,
		getAppGlobals: vi.fn().mockReturnValue( { locale: 'en' } ),
		isWindows: vi.fn().mockReturnValue( false ),
	};
} );
vi.mock( 'src/lib/get-ipc-api', async () => {
	const actual = await vi.importActual( '../../lib/get-ipc-api' );
	return {
		...actual,
		getIpcApi: vi.fn().mockReturnValue( {
			setupAppMenu: vi.fn(),
			getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
			getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
			setWindowControlVisibility: vi.fn(),
			generateProposedSitePath: vi.fn().mockResolvedValue( {
				path: '/default/path',
				name: 'Default Site',
				isEmpty: true,
				isWordPress: false,
			} ),
			getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
			generateSiteNameFromList: vi.fn().mockResolvedValue( 'My WordPress Website' ),
		} ),
	};
} );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: vi.fn( () => ( {
			sites: [
				{ label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
			],
			isLoading: false,
		} ) ),
	};
} );

describe( 'App', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	const renderWithProvider = ( component: React.ReactElement ) => {
		const store = createTestStore();
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>{ component }</ContentTabsProvider>
			</Provider>
		);
	};

	it( 'should display the add-site screen when there are no sites', async () => {
		( useSiteDetails as Mock ).mockReturnValue( {
			sites: [],
			loadingSites: false,
			selectedSite: null,
			loadingServer: {},
		} );

		renderWithProvider( <App /> );

		await waitFor( () => {
			expect( screen.getByText( 'Add a site' ) ).toBeInTheDocument();
		} );
	} );
} );
