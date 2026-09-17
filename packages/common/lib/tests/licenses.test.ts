import { describe, expect, it } from 'vitest';
import { collectLicenseSlugs, isValidLicenseSlug, resolveLicensePlaceholders } from '../licenses';
import type { Blueprint } from '@wp-playground/blueprints';

const vault = ( entries: Record< string, string > ) => ( slug: string ) => entries[ slug ];

describe( 'collectLicenseSlugs', () => {
	it( 'finds slugs in constants and siteOptions', () => {
		const blueprint = {
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}' },
			siteOptions: { automatic_css_license_key: '${studio.license:acss}' },
		} as unknown as Blueprint;

		expect( collectLicenseSlugs( blueprint ) ).toEqual( [ 'bricks', 'acss' ] );
	} );

	it( 'deduplicates a slug used in more than one place', () => {
		const blueprint = {
			constants: { A: '${studio.license:bricks}', B: '${studio.license:bricks}' },
		} as unknown as Blueprint;

		expect( collectLicenseSlugs( blueprint ) ).toEqual( [ 'bricks' ] );
	} );

	it( 'ignores other fields and non-string values', () => {
		const blueprint = {
			meta: { title: '${studio.license:bricks}', author: 'studio' },
			constants: { DEBUG: true },
			steps: [ { step: 'runPHP', code: '${studio.license:bricks}' } ],
		} as unknown as Blueprint;

		expect( collectLicenseSlugs( blueprint ) ).toEqual( [] );
	} );

	it( 'returns nothing for an undefined Blueprint', () => {
		expect( collectLicenseSlugs( undefined ) ).toEqual( [] );
	} );
} );

describe( 'resolveLicensePlaceholders', () => {
	it( 'substitutes keys from the vault', () => {
		const blueprint = {
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}' },
			siteOptions: { automatic_css_license_key: '${studio.license:acss}' },
		} as unknown as Blueprint;

		const result = resolveLicensePlaceholders(
			blueprint,
			vault( { bricks: 'BRICKS-KEY', acss: 'ACSS-KEY' } )
		);

		expect( result.blueprint ).toEqual( {
			constants: { BRICKS_LICENSE_KEY: 'BRICKS-KEY' },
			siteOptions: { automatic_css_license_key: 'ACSS-KEY' },
		} );
		expect( result.resolved.sort() ).toEqual( [ 'acss', 'bricks' ] );
		expect( result.missing ).toEqual( [] );
	} );

	it( 'leaves an unknown placeholder in place and reports it missing', () => {
		const blueprint = {
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}' },
		} as unknown as Blueprint;

		const result = resolveLicensePlaceholders( blueprint, vault( {} ) );

		expect( result.blueprint ).toEqual( {
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}' },
		} );
		expect( result.missing ).toEqual( [ 'bricks' ] );
		expect( result.resolved ).toEqual( [] );
	} );

	it( 'treats an empty stored key as missing', () => {
		const blueprint = {
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}' },
		} as unknown as Blueprint;

		expect( resolveLicensePlaceholders( blueprint, vault( { bricks: '' } ) ).missing ).toEqual( [
			'bricks',
		] );
	} );

	it( 'substitutes a placeholder embedded in a larger string', () => {
		const blueprint = {
			siteOptions: { combined: 'key=${studio.license:acss};mode=pro' },
		} as unknown as Blueprint;

		const result = resolveLicensePlaceholders( blueprint, vault( { acss: 'ACSS-KEY' } ) );

		expect( result.blueprint ).toEqual( {
			siteOptions: { combined: 'key=ACSS-KEY;mode=pro' },
		} );
	} );

	it( 'does not mutate the input Blueprint', () => {
		const blueprint = {
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}' },
		} as unknown as Blueprint;

		resolveLicensePlaceholders( blueprint, vault( { bricks: 'BRICKS-KEY' } ) );

		expect( blueprint ).toEqual( {
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}' },
		} );
	} );

	it( 'preserves unrelated Blueprint fields and non-string constants', () => {
		const blueprint = {
			meta: { title: 'Bricks starter', author: 'studio' },
			constants: { BRICKS_LICENSE_KEY: '${studio.license:bricks}', WP_DEBUG: true },
			steps: [ { step: 'installTheme' } ],
		} as unknown as Blueprint;

		const result = resolveLicensePlaceholders( blueprint, vault( { bricks: 'BRICKS-KEY' } ) );

		expect( result.blueprint ).toEqual( {
			meta: { title: 'Bricks starter', author: 'studio' },
			constants: { BRICKS_LICENSE_KEY: 'BRICKS-KEY', WP_DEBUG: true },
			steps: [ { step: 'installTheme' } ],
		} );
	} );
} );

describe( 'isValidLicenseSlug', () => {
	it.each( [ 'bricks', 'acss', 'schema-wp', 'a1_b2' ] )( 'accepts %s', ( slug ) => {
		expect( isValidLicenseSlug( slug ) ).toBe( true );
	} );

	it.each( [ '', '-leading', '_leading', 'has space', 'has.dot', 'has:colon' ] )(
		'rejects %s',
		( slug ) => {
			expect( isValidLicenseSlug( slug ) ).toBe( false );
		}
	);
} );
