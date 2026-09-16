// To run tests, execute `npm run test -- src/modules/user-settings/components/tests/user-settings.test.tsx` from the root directory
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { UserSettings } from 'src/modules/user-settings';
import { store } from 'src/stores';
import { installedAppsApi } from 'src/stores/installed-apps-api';

vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: vi.fn( () => ( {
		platform: 'darwin',
	} ) ),
	isMac: vi.fn( () => true ),
	isWindows: vi.fn( () => false ),
	isLinux: vi.fn( () => false ),
	isWindowsStore: vi.fn( () => false ),
} ) );
vi.mock( 'src/hooks/use-ipc-listener' );

const mockIpcApi = {
	getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
	getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
	getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( {
		antigravity: false,
		vscode: true,
		phpstorm: false,
		webstorm: false,
		windsurf: false,
		cursor: false,
		sublime: false,
		zed: false,
		terminal: true,
		iterm: false,
		warp: false,
		ghostty: false,
	} ),
	isStudioCliInstalled: vi.fn().mockResolvedValue( true ),
	copyText: vi.fn().mockResolvedValue( undefined ),
	getDefaultSiteDirectory: vi.fn().mockResolvedValue( '/mock/default/site/path' ),
	getColorScheme: vi.fn().mockResolvedValue( 'light' ),
	saveColorScheme: vi.fn().mockResolvedValue( undefined ),
	getQuitSitesBehavior: vi.fn().mockResolvedValue( undefined ),
	saveQuitSitesBehavior: vi.fn().mockResolvedValue( undefined ),
};

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => mockIpcApi,
} ) );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

const mockIpcEvent = {
	ports: [],
	sender: {} as unknown as Electron.IpcRenderer,
	preventDefault: vi.fn(),
	defaultPrevented: false,
};

describe( 'UserSettings', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		store.dispatch( installedAppsApi.util.resetApiState() );
		// Triggers IPC listener to show modal
		vi.mocked( useIpcListener ).mockImplementationOnce( ( listener, callback ) => {
			if ( listener === 'user-settings' ) {
				callback( mockIpcEvent, {} );
			}
		} );
	} );

	it( 'opens the settings dialog when requested over IPC', async () => {
		renderWithProvider( <UserSettings /> );

		expect( await screen.findByRole( 'dialog', { name: 'Settings' } ) ).toBeVisible();
	} );

	it( 'saves the quit-sites behavior preference', async () => {
		const user = userEvent.setup();

		renderWithProvider( <UserSettings /> );

		const quitBehaviorSelect = await screen.findByTestId( 'quit-sites-behavior-select' );
		await user.selectOptions( quitBehaviorSelect, 'stop' );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockIpcApi.saveQuitSitesBehavior ).toHaveBeenCalledWith( 'stop' );
	} );

	it( 'clears the quit-sites behavior preference when asking every time', async () => {
		const user = userEvent.setup();
		mockIpcApi.getQuitSitesBehavior.mockResolvedValueOnce( 'stop' );

		renderWithProvider( <UserSettings /> );

		const quitBehaviorSelect = await screen.findByTestId( 'quit-sites-behavior-select' );
		await waitFor( () => expect( quitBehaviorSelect ).toHaveValue( 'stop' ) );
		await user.selectOptions( quitBehaviorSelect, '' );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockIpcApi.saveQuitSitesBehavior ).toHaveBeenCalledWith( undefined );
	} );
} );
