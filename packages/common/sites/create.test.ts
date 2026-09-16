import { describe, expect, it } from 'vitest';
import { buildSiteCreateArgs } from './create';

// Reads a flag's value out of the built argv (the token right after `--<name>`).
function argValue( args: string[], flag: string ): string | undefined {
	const index = args.indexOf( flag );
	return index === -1 ? undefined : args[ index + 1 ];
}

describe( 'buildSiteCreateArgs', () => {
	it( 'always passes the site path and skips the browser and log details', () => {
		const { args } = buildSiteCreateArgs( { path: '/tmp/site' } );

		expect( args.slice( 0, 2 ) ).toEqual( [ 'site', 'create' ] );
		expect( argValue( args, '--path' ) ).toBe( '/tmp/site' );
		expect( args ).toContain( '--skip-browser' );
		expect( args ).toContain( '--skip-log-details' );
	} );

	it( 'appends optional site settings only when provided', () => {
		const { args } = buildSiteCreateArgs( {
			path: '/tmp/site',
			name: 'My Site',
			phpVersion: '8.3',
			customDomain: 'my-site.wp.local',
			enableHttps: true,
		} );

		expect( argValue( args, '--name' ) ).toBe( 'My Site' );
		expect( argValue( args, '--php' ) ).toBe( '8.3' );
		expect( argValue( args, '--domain' ) ).toBe( 'my-site.wp.local' );
		expect( args ).toContain( '--https' );
		expect( args ).not.toContain( '--wp' );
	} );
} );
