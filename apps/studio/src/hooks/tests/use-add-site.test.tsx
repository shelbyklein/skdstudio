// Run tests: yarn test -- src/hooks/tests/use-add-site.test.tsx
import { renderHook, act } from '@testing-library/react';
import nock from 'nock';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useAddSite, CreateSiteFormValues } from 'src/hooks/use-add-site';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { store } from 'src/stores';

vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/hooks/use-feature-flags' );
vi.mock( 'src/hooks/use-import-export', () => ( {
	useImportExport: () => ( {
		importFile: vi.fn(),
		clearImportState: vi.fn(),
		importState: {},
	} ),
} ) );

const mockShowOpenFolderDialog = vi.fn();
const mockGenerateProposedSitePath = vi.fn().mockResolvedValue( {
	path: '/default/path',
	name: 'Default Site',
	isEmpty: true,
	isWordPress: false,
} );
const mockComparePaths = vi.fn().mockResolvedValue( false );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		generateProposedSitePath: mockGenerateProposedSitePath,
		showOpenFolderDialog: mockShowOpenFolderDialog,
		showNotification: vi.fn(),
		getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
		comparePaths: mockComparePaths,
	} ),
} ) );

const renderHookWithProvider = ( hook: () => ReturnType< typeof useAddSite > ) => {
	return renderHook< ReturnType< typeof useAddSite >, void >( hook, {
		wrapper: ( { children } ) => <Provider store={ store }>{ children }</Provider>,
	} );
};

describe( 'useAddSite', () => {
	const mockCreateSite = vi.fn();
	const mockUpdateSite = vi.fn();
	const mockStartServer = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default/path',
			name: 'Default Site',
			isEmpty: true,
			isWordPress: false,
		} );

		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			createSite: mockCreateSite,
			updateSite: mockUpdateSite,
			sites: [],
			loadingSites: false,
			startServer: mockStartServer,
		} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [
					{
						version: '6.1.7',
						response: 'autoupdate',
					},
					{
						version: '6.2.0',
						response: 'autoupdate',
					},
				],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, {
				offers: [],
			} );
	} );

	afterEach( () => {
		nock.cleanAll();
	} );

	it( 'should create site with provided form values', async () => {
		mockCreateSite.mockImplementation(
			( path, name, wpVersion, customDomain, enableHttps, blueprint, phpVersion, callback ) => {
				callback( {
					id: 'test-id',
					name: name || 'Test Site',
					path,
					wpVersion,
					phpVersion,
				} );
				return Promise.resolve();
			}
		);

		const { result } = renderHookWithProvider( () => useAddSite() );

		const formValues: CreateSiteFormValues = {
			siteName: 'My Test Site',
			sitePath: '/test/path',
			phpVersion: '8.2',
			wpVersion: '6.1.7',
			useCustomDomain: false,
			customDomain: null,
			enableHttps: false,
		};

		await act( async () => {
			await result.current.handleCreateSite( formValues );
		} );

		expect( mockCreateSite ).toHaveBeenCalledWith(
			'/test/path',
			'My Test Site',
			'6.1.7',
			undefined,
			false,
			undefined, // blueprint parameter
			'8.2',
			expect.any( Function ),
			false,
			undefined, // adminUsername
			undefined, // adminPassword
			undefined, // adminEmail
			undefined, // runtime
			undefined // fileAccess
		);
	} );

	it( 'should generate proposed path for site name', async () => {
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/studio/my-site',
			isEmpty: true,
			isWordPress: false,
		} );

		const { result } = renderHookWithProvider( () => useAddSite() );

		let pathResult;
		await act( async () => {
			pathResult = await result.current.generateProposedPath( 'My Site' );
		} );

		expect( mockGenerateProposedSitePath ).toHaveBeenCalledWith( 'My Site' );
		expect( pathResult ).toEqual( {
			path: '/studio/my-site',
			isEmpty: true,
			isWordPress: false,
		} );
	} );
} );
