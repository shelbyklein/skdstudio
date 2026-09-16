import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import {
	SiteManagementActionProps,
	SiteManagementActions,
} from 'src/components/site-management-actions';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn( () => ( {} ) ),
} ) );

// Mock useSiteDetails to return the site passed via context
vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		selectedSite: { id: 'site-1', running: false },
	} ),
} ) );

const defaultProps = {
	onStart: vi.fn(),
	onStop: vi.fn(),
	loading: false,
} as SiteManagementActionProps;

describe( 'SiteManagementActions', () => {
	const renderWithProviders = ( props: SiteManagementActionProps ) =>
		render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<SiteManagementActions { ...props } />
				</ContentTabsProvider>
			</Provider>
		);

	it( 'should not render when selectedSite is undefined', () => {
		const { container } = renderWithProviders( { ...defaultProps, selectedSite: undefined } );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'should render correctly with a running site', () => {
		renderWithProviders( {
			...defaultProps,
			selectedSite: { id: 'site-1', running: true } as SiteDetails,
		} );
		expect( screen.getByRole( 'button', { name: 'Running' } ) ).toBeVisible();
	} );

	it( 'should change text to Stop when hovered over a running site', async () => {
		const user = userEvent.setup();
		renderWithProviders( {
			...defaultProps,
			selectedSite: { id: 'site-1', running: true } as SiteDetails,
		} );
		const startStopButton = screen.getByRole( 'button', { name: 'Running' } );
		await user.hover( startStopButton );
		expect( startStopButton ).toHaveTextContent( 'Stop' );
	} );

	it( 'should render "Start" button when site is not running', () => {
		renderWithProviders( {
			...defaultProps,
			selectedSite: { id: 'site-1', running: false } as SiteDetails,
		} );
		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toBeVisible();
	} );
} );
