/**
 * Rewrites a site's URL inside a MySQL dump, keeping PHP serialized data valid.
 *
 * WordPress stores serialized arrays in `wp_options` and `*meta`, and every
 * serialized string carries its own byte length (`s:21:"http://localhost:8881"`).
 * A plain text substitution changes the string but not the length, and PHP then
 * refuses to unserialize the value — which is how widget settings, theme mods
 * and plugin options silently disappear after a naive find-and-replace.
 *
 * The rewrite is done here rather than on the server so that it works the same
 * whether the server has WP-CLI or only the mysql client, and so the local
 * database is never modified to produce a deployable dump.
 *
 * Bytes, not characters: PHP counts bytes, so the dump is processed as latin1,
 * where one JavaScript character is exactly one byte. Multi-byte UTF-8 survives
 * unchanged because it is copied through verbatim.
 */

/** Escape sequences that stand for a single byte in a MySQL string literal. */
const SINGLE_BYTE_ESCAPES = new Set( [ '0', 'b', 'n', 'r', 't', 'Z', '\\', "'", '"' ] );

export interface SqlUrlRewriteResult {
	sql: string;
	/** How many occurrences of the URL were replaced, across all forms. */
	replacements: number;
}

/**
 * The textual forms a URL takes inside a dump. Beyond the plain form, WordPress
 * stores JSON in options and post content, where forward slashes are escaped;
 * that JSON is itself inside a SQL literal, so its backslashes may be doubled.
 * Longest first, so the doubled form is matched before the single one.
 */
function getUrlForms( url: string ): string[] {
	return [ url.replace( /\//g, '\\\\/' ), url.replace( /\//g, '\\/' ), url ];
}

/**
 * Counts the bytes a literal's text represents once MySQL has unescaped it.
 * `\%` and `\_` are the two sequences MySQL leaves as two characters.
 */
function unescapedByteLength( text: string ): number {
	let length = 0;
	let index = 0;
	while ( index < text.length ) {
		const char = text[ index ];
		if ( char === '\\' && index + 1 < text.length ) {
			const next = text[ index + 1 ];
			length += SINGLE_BYTE_ESCAPES.has( next ) ? 1 : 2;
			index += 2;
			continue;
		}
		if ( char === "'" && text[ index + 1 ] === "'" ) {
			length += 1;
			index += 2;
			continue;
		}
		length += 1;
		index += 1;
	}
	return length;
}

/**
 * Walks forward from `start` until `target` unescaped bytes have been consumed,
 * returning the index just past them, or -1 if the text runs out first.
 */
function findPayloadEnd( text: string, start: number, target: number ): number {
	let length = 0;
	let index = start;
	while ( index < text.length && length < target ) {
		const char = text[ index ];
		if ( char === '\\' && index + 1 < text.length ) {
			length += SINGLE_BYTE_ESCAPES.has( text[ index + 1 ] ) ? 1 : 2;
			index += 2;
			continue;
		}
		if ( char === "'" && text[ index + 1 ] === "'" ) {
			length += 1;
			index += 2;
			continue;
		}
		length += 1;
		index += 1;
	}
	return length === target ? index : -1;
}

/** Matches the header of a serialized string: `s:<length>:` then its opening quote. */
const SERIALIZED_STRING_HEADER = /s:(\d+):(\\?")/g;

function replacePlain(
	text: string,
	forms: string[],
	toForms: string[]
): { text: string; count: number } {
	let result = text;
	let count = 0;
	for ( let index = 0; index < forms.length; index++ ) {
		const from = forms[ index ];
		const to = toForms[ index ];
		if ( from === to || ! result.includes( from ) ) {
			continue;
		}
		const parts = result.split( from );
		count += parts.length - 1;
		result = parts.join( to );
	}
	return { text: result, count };
}

/**
 * Rewrites one stretch of dump text: substitutes the URL everywhere, and for
 * each serialized string, rewrites its payload first and then restates its
 * length. Nested serialized data is handled by the recursion, which finishes
 * the inner strings before the enclosing length is measured.
 */
function rewriteRegion(
	text: string,
	fromForms: string[],
	toForms: string[],
	counter: { count: number }
): string {
	let output = '';
	let cursor = 0;

	SERIALIZED_STRING_HEADER.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ( ( match = SERIALIZED_STRING_HEADER.exec( text ) ) !== null ) {
		const declaredLength = Number( match[ 1 ] );
		const quote = match[ 2 ];
		const payloadStart = match.index + match[ 0 ].length;
		const payloadEnd = findPayloadEnd( text, payloadStart, declaredLength );

		// A length that does not line up means this is not really a serialized
		// string (or the dump is truncated). Leave it for the plain pass.
		if ( payloadEnd === -1 || text.slice( payloadEnd, payloadEnd + quote.length ) !== quote ) {
			continue;
		}

		const before = text.slice( cursor, match.index );
		const beforeResult = replacePlain( before, fromForms, toForms );
		counter.count += beforeResult.count;
		output += beforeResult.text;

		const payload = rewriteRegion(
			text.slice( payloadStart, payloadEnd ),
			fromForms,
			toForms,
			counter
		);
		output += `s:${ unescapedByteLength( payload ) }:${ quote }${ payload }${ quote }`;

		cursor = payloadEnd + quote.length;
		SERIALIZED_STRING_HEADER.lastIndex = cursor;
	}

	const tail = replacePlain( text.slice( cursor ), fromForms, toForms );
	counter.count += tail.count;
	return output + tail.text;
}

/**
 * Replaces `fromUrl` with `toUrl` throughout a SQL dump.
 *
 * Both URLs are expected without a trailing slash, so that `http://old` matches
 * `http://old/wp-content/...` as well as a bare `http://old`.
 */
export function rewriteSqlUrls( sql: string, fromUrl: string, toUrl: string ): SqlUrlRewriteResult {
	if ( ! fromUrl || ! toUrl || fromUrl === toUrl ) {
		return { sql, replacements: 0 };
	}

	const asBytes = Buffer.from( sql, 'utf8' ).toString( 'latin1' );
	const counter = { count: 0 };
	const rewritten = rewriteRegion( asBytes, getUrlForms( fromUrl ), getUrlForms( toUrl ), counter );

	return {
		sql: Buffer.from( rewritten, 'latin1' ).toString( 'utf8' ),
		replacements: counter.count,
	};
}

/**
 * Finds the addresses a dump says the site is served from.
 *
 * Studio forces WP_HOME and WP_SITEURL at runtime, so a site keeps working
 * after its port changes and the stale address stays in the database and in
 * saved content. Rewriting what the dump actually contains catches that drift,
 * rather than only the address the site answers on today.
 */
export function findSiteUrlsInDump( sql: string ): string[] {
	const found = new Set< string >();
	const pattern = /'(?:siteurl|home)',\s*'(https?:\/\/[^']+)'/g;

	let match: RegExpExecArray | null;
	while ( ( match = pattern.exec( sql ) ) !== null ) {
		const url = match[ 1 ].replace( /\/+$/, '' );
		if ( url ) {
			found.add( url );
		}
	}

	return [ ...found ];
}
