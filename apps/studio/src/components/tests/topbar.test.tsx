import { render, act, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import TopBar from 'src/components/top-bar';
import { useOffline } from 'src/hooks/use-offline';
import { store } from 'src/stores';

vi.mock( 'src/hooks/use-offline' );
vi.mock( 'src/lib/app-globals', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('src/lib/app-globals') >() ),
	isWindows: () => false,
} ) );

const mockOpenURL = vi.fn();
const toggleMinWindowWidth = vi.fn();
vi.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: vi.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: vi.fn(),
		generateProposedSitePath: vi.fn(),
		openURL: mockOpenURL,
		toggleMinWindowWidth,
	} ),
} ) );

const renderWithProvider = ( children: React.ReactElement ) => {
	return render( <Provider store={ store }>{ children }</Provider> );
};

describe( 'TopBar', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useOffline ).mockReturnValue( false );
	} );

	it( 'renders the settings button', async () => {
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> ) );
		expect( screen.getByRole( 'button', { name: 'Open settings' } ) ).toBeVisible();
	} );

	it( 'shows offline indicator', async () => {
		vi.mocked( useOffline ).mockReturnValue( true );
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> ) );
		const offlineIndicator = screen.getByRole( 'status', {
			name: 'Offline indicator',
		} );
		expect( offlineIndicator ).toHaveAttribute( 'aria-description' );
		expect( offlineIndicator ).toHaveAttribute(
			'aria-description',
			expect.stringContaining( 'offline' )
		);
	} );

	it( 'opens the support URL', async () => {
		const user = userEvent.setup();

		renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> );

		const helpIconButton = screen.getByRole( 'button', { name: 'Get help' } );
		await user.click( helpIconButton );
		await waitFor( () =>
			expect( mockOpenURL ).toHaveBeenCalledWith(
				`https://developer.wordpress.com/docs/developer-tools/studio/`
			)
		);
	} );

	it( 'calls toggleMinWindowWidth when sidebar toggle button is clicked', async () => {
		const user = userEvent.setup();
		const onToggleSidebar = vi.fn().mockImplementation( () => {
			toggleMinWindowWidth( true );
		} );

		renderWithProvider( <TopBar onToggleSidebar={ onToggleSidebar } /> );

		const toggleButton = screen.getByRole( 'button', { name: 'Toggle sidebar' } );
		await user.click( toggleButton );

		expect( onToggleSidebar ).toHaveBeenCalledTimes( 1 );
		expect( toggleMinWindowWidth ).toHaveBeenCalledTimes( 1 );
	} );
} );
