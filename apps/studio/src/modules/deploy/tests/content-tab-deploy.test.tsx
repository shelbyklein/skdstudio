import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ContentTabDeploy } from 'src/modules/deploy/components/content-tab-deploy';

const saveDeployTarget = vi.fn();
const deploySite = vi.fn();
const showMessageBox = vi.fn();

vi.mock( 'src/lib/get-ipc-api', async () => ( {
	...( await vi.importActual( '../../../lib/get-ipc-api' ) ),
	getIpcApi: vi.fn( () => ( {
		saveDeployTarget,
		deploySite,
		cancelDeploy: vi.fn(),
		showMessageBox,
	} ) ),
} ) );

vi.mock( 'src/hooks/use-ipc-listener', () => ( {
	useIpcListener: vi.fn(),
} ) );

const baseSite: SiteDetails = {
	id: 'site-1',
	name: 'Test Site',
	running: false,
	path: '/sites/test',
	port: 8881,
	phpVersion: '8.4',
};

const configuredSite: SiteDetails = {
	...baseSite,
	deployTarget: {
		host: 'example.com',
		user: 'deploy',
		remotePath: '/var/www/site',
		remoteUrl: 'https://example.com',
	},
};

beforeEach( () => {
	vi.clearAllMocks();
	saveDeployTarget.mockResolvedValue( {
		host: 'example.com',
		remotePath: '/var/www/site',
		remoteUrl: 'https://example.com',
	} );
	deploySite.mockResolvedValue( { completed: true, warnings: [] } );
	// The confirmation dialog resolves to the confirm button.
	showMessageBox.mockResolvedValue( { response: 0, checkboxChecked: false } );
} );

describe( 'ContentTabDeploy', () => {
	it( 'starts on the form when no server is set up', () => {
		render( <ContentTabDeploy selectedSite={ baseSite } /> );

		expect( screen.getByRole( 'button', { name: 'Save server' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Deploy to server' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the saved server and the deploy actions once one exists', () => {
		render( <ContentTabDeploy selectedSite={ configuredSite } /> );

		expect( screen.getByText( 'deploy@example.com' ) ).toBeInTheDocument();
		expect( screen.getByText( '/var/www/site' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Deploy to server' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Dry run' } ) ).toBeInTheDocument();
	} );

	it( 'reports the field that is wrong instead of saving', async () => {
		const user = userEvent.setup();
		render( <ContentTabDeploy selectedSite={ baseSite } /> );

		await user.type( screen.getByLabelText( 'Host' ), 'example.com' );
		await user.type( screen.getByLabelText( 'Remote path' ), 'webapps/mysite' );
		await user.type( screen.getByLabelText( 'Site address' ), 'https://example.com' );
		await user.click( screen.getByRole( 'button', { name: 'Save server' } ) );

		expect( await screen.findByText( /must be absolute/i ) ).toBeInTheDocument();
		expect( saveDeployTarget ).not.toHaveBeenCalled();
	} );

	it( 'saves a complete server', async () => {
		const user = userEvent.setup();
		render( <ContentTabDeploy selectedSite={ baseSite } /> );

		await user.type( screen.getByLabelText( 'Host' ), 'example.com' );
		await user.type( screen.getByLabelText( 'Remote path' ), '/var/www/site' );
		await user.type( screen.getByLabelText( 'Site address' ), 'https://example.com' );
		await user.click( screen.getByRole( 'button', { name: 'Save server' } ) );

		await waitFor( () => {
			expect( saveDeployTarget ).toHaveBeenCalledWith(
				'site-1',
				expect.objectContaining( {
					host: 'example.com',
					remotePath: '/var/www/site',
					remoteUrl: 'https://example.com',
					deleteRemoved: true,
				} )
			);
		} );
	} );

	it( 'shows the deploy actions right after saving, before the site record catches up', async () => {
		const user = userEvent.setup();
		render( <ContentTabDeploy selectedSite={ baseSite } /> );

		await user.type( screen.getByLabelText( 'Host' ), 'example.com' );
		await user.type( screen.getByLabelText( 'Remote path' ), '/var/www/site' );
		await user.type( screen.getByLabelText( 'Site address' ), 'https://example.com' );
		await user.click( screen.getByRole( 'button', { name: 'Save server' } ) );

		expect( await screen.findByRole( 'button', { name: 'Deploy to server' } ) ).toBeInTheDocument();
	} );

	it( 'asks before replacing the live site', async () => {
		const user = userEvent.setup();
		render( <ContentTabDeploy selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Deploy to server' } ) );

		await waitFor( () => expect( showMessageBox ).toHaveBeenCalled() );
		expect( showMessageBox.mock.calls[ 0 ][ 0 ].detail ).toContain( 'https://example.com' );
		await waitFor( () => expect( deploySite ).toHaveBeenCalledWith( 'site-1', {} ) );
	} );

	it( 'does not deploy when the confirmation is declined', async () => {
		showMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );
		const user = userEvent.setup();
		render( <ContentTabDeploy selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Deploy to server' } ) );

		await waitFor( () => expect( showMessageBox ).toHaveBeenCalled() );
		expect( deploySite ).not.toHaveBeenCalled();
	} );

	it( 'runs a dry run without asking', async () => {
		const user = userEvent.setup();
		render( <ContentTabDeploy selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Dry run' } ) );

		await waitFor( () => expect( deploySite ).toHaveBeenCalledWith( 'site-1', { dryRun: true } ) );
		expect( showMessageBox ).not.toHaveBeenCalled();
	} );

	it( 'surfaces a failed deploy', async () => {
		deploySite.mockRejectedValue( new Error( 'The server rejected the SSH key.' ) );
		const user = userEvent.setup();
		render( <ContentTabDeploy selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Dry run' } ) );

		await waitFor( () =>
			expect( document.body ).toHaveTextContent( 'The server rejected the SSH key.' )
		);
	} );
} );
