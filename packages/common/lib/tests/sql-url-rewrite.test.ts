import { findSiteUrlsInDump, rewriteSqlUrls } from '../sql-url-rewrite';

const LOCAL = 'http://localhost:8881';
const REMOTE = 'https://example.com';

describe( 'rewriteSqlUrls', () => {
	it( 'replaces the URL in a plain column value', () => {
		const sql = `INSERT INTO wp_options VALUES (1,'siteurl','${ LOCAL }','yes');`;

		const { sql: result, replacements } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).toBe( `INSERT INTO wp_options VALUES (1,'siteurl','${ REMOTE }','yes');` );
		expect( replacements ).toBe( 1 );
	} );

	it( 'replaces the URL when it carries a path', () => {
		const sql = `'${ LOCAL }/wp-content/uploads/2026/09/photo.jpg'`;

		const { result } = { result: rewriteSqlUrls( sql, LOCAL, REMOTE ).sql };

		expect( result ).toBe( `'${ REMOTE }/wp-content/uploads/2026/09/photo.jpg'` );
	} );

	it( 'restates the byte length of a serialized string it shortens', () => {
		const sql = `'a:1:{s:3:\\"url\\";s:21:\\"${ LOCAL }\\";}'`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).toBe( `'a:1:{s:3:\\"url\\";s:19:\\"${ REMOTE }\\";}'` );
	} );

	it( 'restates the byte length of a serialized string it lengthens', () => {
		const sql = `s:21:"${ LOCAL }";`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, 'https://a-much-longer-domain.example' );

		expect( result ).toBe( 's:36:"https://a-much-longer-domain.example";' );
	} );

	it( 'leaves a serialized string alone when it does not hold the URL', () => {
		const sql = 's:5:"hello";';

		const { sql: result, replacements } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).toBe( sql );
		expect( replacements ).toBe( 0 );
	} );

	it( 'measures the payload in bytes, not characters', () => {
		// "café" is five bytes in UTF-8 and the URL adds twenty-one more.
		const sql = `s:26:"café${ LOCAL }";`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).toBe( `s:24:"café${ REMOTE }";` );
	} );

	it( 'handles a serialized string nested inside another', () => {
		const inner = `a:1:{s:3:\\"url\\";s:21:\\"${ LOCAL }\\";}`;
		const sql = `'s:${ inner.replace( /\\"/g, '"' ).length }:\\"${ inner }\\";'`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		const expectedInner = `a:1:{s:3:\\"url\\";s:19:\\"${ REMOTE }\\";}`;
		const expectedLength = expectedInner.replace( /\\"/g, '"' ).length;
		expect( result ).toBe( `'s:${ expectedLength }:\\"${ expectedInner }\\";'` );
	} );

	it( 'counts an escaped quote inside a payload as one byte', () => {
		const sql = `s:28:"say \\"hi\\" ${ LOCAL }";`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		// 'say "hi" ' is nine bytes, plus the nineteen-byte replacement URL.
		expect( result ).toBe( `s:28:"say \\"hi\\" ${ REMOTE }";` );
	} );

	it( 'replaces the JSON-escaped form used inside block markup', () => {
		const escapedLocal = LOCAL.replace( /\//g, '\\/' );
		const escapedRemote = REMOTE.replace( /\//g, '\\/' );
		const sql = `'{"url":"${ escapedLocal }/logo.png"}'`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).toBe( `'{"url":"${ escapedRemote }/logo.png"}'` );
	} );

	it( 'replaces the JSON-escaped form whose backslashes the dump doubled', () => {
		const sql = `'{"url":"http:\\\\/\\\\/localhost:8881"}'`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).toBe( `'{"url":"https:\\\\/\\\\/example.com"}'` );
	} );

	it( 'keeps a serialized payload valid when the JSON-escaped URL inside it changes length', () => {
		// s:31: covers '{"u":"http:\/\/localhost:8881"}' as MySQL unescapes it.
		const payload = `{\\"u\\":\\"http:\\\\/\\\\/localhost:8881\\"}`;
		const sql = `s:31:\\"${ payload }\\";`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		const declared = Number( /s:(\d+):/.exec( result )![ 1 ] );
		const unescaped = result
			.slice( result.indexOf( '\\"' ) + 2, result.lastIndexOf( '\\";' ) )
			.replace( /\\\\/g, '\\' )
			.replace( /\\"/g, '"' );
		expect( declared ).toBe( Buffer.byteLength( unescaped, 'utf8' ) );
		expect( unescaped ).toBe( '{"u":"https:\\/\\/example.com"}' );
	} );

	it( 'returns the dump untouched when the URLs match', () => {
		const sql = `'${ LOCAL }'`;

		expect( rewriteSqlUrls( sql, LOCAL, LOCAL ) ).toEqual( { sql, replacements: 0 } );
	} );

	it( 'returns the dump untouched when either URL is empty', () => {
		const sql = `'${ LOCAL }'`;

		expect( rewriteSqlUrls( sql, '', REMOTE ).sql ).toBe( sql );
		expect( rewriteSqlUrls( sql, LOCAL, '' ).sql ).toBe( sql );
	} );

	it( 'rewrites every occurrence across a multi-row insert', () => {
		const sql = [
			`INSERT INTO wp_posts VALUES (1,'<img src="${ LOCAL }/a.png">'),`,
			`(2,'<a href="${ LOCAL }/about">about</a>');`,
		].join( '\n' );

		const { sql: result, replacements } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).not.toContain( LOCAL );
		expect( replacements ).toBe( 2 );
	} );

	it( 'ignores an s: header whose declared length does not line up', () => {
		const sql = `s:999:"${ LOCAL }";`;

		const { sql: result } = rewriteSqlUrls( sql, LOCAL, REMOTE );

		expect( result ).toBe( `s:999:"${ REMOTE }";` );
	} );
} );

describe( 'findSiteUrlsInDump', () => {
	it( 'finds the siteurl and home options', () => {
		const sql = [
			"INSERT INTO `wp_options` VALUES (1,'siteurl','http://localhost:8881','yes');",
			"INSERT INTO `wp_options` VALUES (2,'home','http://localhost:8881','yes');",
			"INSERT INTO `wp_options` VALUES (3,'blogname','My site','yes');",
		].join( '\n' );

		expect( findSiteUrlsInDump( sql ) ).toEqual( [ 'http://localhost:8881' ] );
	} );

	it( 'reports both addresses when the database has drifted', () => {
		const sql = [
			"INSERT INTO `wp_options` VALUES (1,'siteurl','http://localhost:8881','yes');",
			"INSERT INTO `wp_options` VALUES (2,'home','https://mysite.local','yes');",
		].join( '\n' );

		expect( findSiteUrlsInDump( sql ).sort() ).toEqual( [
			'http://localhost:8881',
			'https://mysite.local',
		] );
	} );

	it( 'strips a trailing slash', () => {
		const sql = "INSERT INTO `wp_options` VALUES (1,'siteurl','http://localhost:8881/','yes');";

		expect( findSiteUrlsInDump( sql ) ).toEqual( [ 'http://localhost:8881' ] );
	} );

	it( 'finds nothing in a dump without those options', () => {
		expect( findSiteUrlsInDump( "INSERT INTO `wp_posts` VALUES (1,'hello');" ) ).toEqual( [] );
	} );
} );
