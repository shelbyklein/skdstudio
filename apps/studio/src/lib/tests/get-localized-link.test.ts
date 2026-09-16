import { getLocalizedLink } from 'src/lib/get-localized-link';

describe( 'getLocalizedLink', () => {
	it( 'should return English URLs when locale is en', () => {
		expect( getLocalizedLink( 'en', 'docsStudio' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);
		expect( getLocalizedLink( 'en', 'docsImportExport' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
		);
	} );

	it( 'should return English URLs when the locale has no translation', () => {
		expect( getLocalizedLink( 'uk', 'docsSites' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
		);
		expect( getLocalizedLink( 'fr', 'docsCli' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/cli/'
		);
	} );

	it( 'should return English URLs for links that are only available in English', () => {
		expect( getLocalizedLink( 'es', 'docsXdebug' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/xdebug/'
		);
	} );

	it( 'should return Spanish URLs when locale is es', () => {
		expect( getLocalizedLink( 'es', 'docsStudio' ) ).toBe(
			'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/'
		);
		expect( getLocalizedLink( 'es', 'docsImportExport' ) ).toBe(
			'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/importar-exportar/'
		);
	} );
} );
