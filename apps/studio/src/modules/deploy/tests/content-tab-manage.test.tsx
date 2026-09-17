import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ContentTabManage } from 'src/modules/deploy/components/content-tab-manage';

const saveDeployTarget = vi.fn();
const deploySite = vi.fn();
const pullSite = vi.fn();
const showMessageBox = vi.fn();

vi.mock( 'src/lib/get-ipc-api', async () => ( {
	...( await vi.importActual( '../../../lib/get-ipc-api' ) ),
	getIpcApi: vi.fn( () => ( {
		saveDeployTarget,
		deploySite,
		pullSite,
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
	pullSite.mockResolvedValue( { completed: true, warnings: [] } );
	// The confirmation dialog resolves to the confirm button.
	showMessageBox.mockResolvedValue( { response: 0, checkboxChecked: false } );
} );

describe( 'ContentTabManage', () => {
	it( 'starts on the form when no server is set up', () => {
		render( <ContentTabManage selectedSite={ baseSite } /> );

		expect( screen.getByRole( 'button', { name: 'Save server' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Push to server' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the saved server and the deploy actions once one exists', () => {
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		expect( screen.getByText( 'deploy@example.com' ) ).toBeInTheDocument();
		expect( screen.getByText( '/var/www/site' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Push to server' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Preview push' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Pull from server' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Preview pull' } ) ).toBeInTheDocument();
	} );

	it( 'reports the field that is wrong instead of saving', async () => {
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ baseSite } /> );

		await user.type( screen.getByLabelText( 'Host' ), 'example.com' );
		await user.type( screen.getByLabelText( 'Remote path' ), 'webapps/mysite' );
		await user.type( screen.getByLabelText( 'Site address' ), 'https://example.com' );
		await user.click( screen.getByRole( 'button', { name: 'Save server' } ) );

		expect( await screen.findByText( /must be absolute/i ) ).toBeInTheDocument();
		expect( saveDeployTarget ).not.toHaveBeenCalled();
	} );

	it( 'saves a complete server', async () => {
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ baseSite } /> );

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
		render( <ContentTabManage selectedSite={ baseSite } /> );

		await user.type( screen.getByLabelText( 'Host' ), 'example.com' );
		await user.type( screen.getByLabelText( 'Remote path' ), '/var/www/site' );
		await user.type( screen.getByLabelText( 'Site address' ), 'https://example.com' );
		await user.click( screen.getByRole( 'button', { name: 'Save server' } ) );

		expect( await screen.findByRole( 'button', { name: 'Push to server' } ) ).toBeInTheDocument();
	} );

	it( 'asks before replacing the live site', async () => {
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Push to server' } ) );

		await waitFor( () => expect( showMessageBox ).toHaveBeenCalled() );
		expect( showMessageBox.mock.calls[ 0 ][ 0 ].detail ).toContain( 'https://example.com' );
		await waitFor( () => expect( deploySite ).toHaveBeenCalledWith( 'site-1', {} ) );
	} );

	it( 'does not deploy when the confirmation is declined', async () => {
		showMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Push to server' } ) );

		await waitFor( () => expect( showMessageBox ).toHaveBeenCalled() );
		expect( deploySite ).not.toHaveBeenCalled();
	} );

	it( 'previews a push without asking', async () => {
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Preview push' } ) );

		await waitFor( () => expect( deploySite ).toHaveBeenCalledWith( 'site-1', { dryRun: true } ) );
		expect( showMessageBox ).not.toHaveBeenCalled();
	} );

	it( 'asks before replacing the local site, then pulls', async () => {
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Pull from server' } ) );

		await waitFor( () => expect( showMessageBox ).toHaveBeenCalled() );
		expect( showMessageBox.mock.calls[ 0 ][ 0 ].detail ).toContain( 'https://example.com' );
		await waitFor( () => expect( pullSite ).toHaveBeenCalledWith( 'site-1', {} ) );
		expect( deploySite ).not.toHaveBeenCalled();
	} );

	it( 'does not pull when the confirmation is declined', async () => {
		showMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Pull from server' } ) );

		await waitFor( () => expect( showMessageBox ).toHaveBeenCalled() );
		expect( pullSite ).not.toHaveBeenCalled();
	} );

	it( 'surfaces a failed pull', async () => {
		pullSite.mockRejectedValue( new Error( 'The server refused the connection.' ) );
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Pull from server' } ) );

		await waitFor( () =>
			expect( document.body ).toHaveTextContent( 'The server refused the connection.' )
		);
	} );

	it( 'previews a pull without asking', async () => {
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Preview pull' } ) );

		await waitFor( () => expect( pullSite ).toHaveBeenCalledWith( 'site-1', { dryRun: true } ) );
		expect( showMessageBox ).not.toHaveBeenCalled();
	} );

	it( 'surfaces a failed push', async () => {
		deploySite.mockRejectedValue( new Error( 'The server rejected the SSH key.' ) );
		const user = userEvent.setup();
		render( <ContentTabManage selectedSite={ configuredSite } /> );

		await user.click( screen.getByRole( 'button', { name: 'Preview push' } ) );

		await waitFor( () =>
			expect( document.body ).toHaveTextContent( 'The server rejected the SSH key.' )
		);
	} );
} );
