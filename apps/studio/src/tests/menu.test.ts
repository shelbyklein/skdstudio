/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { buildViewMenuItems } from 'src/menu';

function buildTestViewMenuItems(
	overrides: Partial< Parameters< typeof buildViewMenuItems >[ 0 ] > = {}
) {
	return buildViewMenuItems( {
		isDevelopment: false,
		isAlwaysOnTop: false,
		devTools: [],
		onToggleSidebar: vi.fn(),
		onResetZoom: vi.fn(),
		onZoomIn: vi.fn(),
		onZoomOut: vi.fn(),
		...overrides,
	} );
}

function getLabels( items = buildTestViewMenuItems() ) {
	return items.map( ( item ) => item.label ).filter( Boolean );
}

describe( 'buildViewMenuItems', () => {
	it( 'keeps development tools after the sidebar toggle', () => {
		expect(
			getLabels(
				buildTestViewMenuItems( {
					isDevelopment: true,
					devTools: [ { label: 'Reload', role: 'reload' } ],
				} )
			)
		).toEqual( [
			'Toggle Sidebar',
			'Reload',
			'Actual Size',
			'Zoom In',
			'Zoom Out',
			'Toggle Fullscreen',
			'Float on Top of All Other Windows',
		] );
	} );

	it( 'hides development tools outside development', () => {
		expect( getLabels() ).not.toContain( 'Reload' );
	} );

	it.each( [
		[ 'Actual Size', 'CommandOrControl+0', 'onResetZoom' ],
		[ 'Zoom In', 'CommandOrControl+Plus', 'onZoomIn' ],
		[ 'Zoom Out', 'CommandOrControl+-', 'onZoomOut' ],
	] as const )( 'targets the app for %s', ( label, accelerator, callbackName ) => {
		const callback = vi.fn();
		const item = buildTestViewMenuItems( { [ callbackName ]: callback } ).find(
			( candidate ) => candidate.label === label
		);

		expect( item ).toMatchObject( { accelerator } );
		expect( item?.role ).toBeUndefined();

		item?.click?.( {} as never, undefined as never, undefined as never );

		expect( callback ).toHaveBeenCalledTimes( 1 );
	} );
} );
