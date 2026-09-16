import {
	DeployTargetError,
	describeDeployTarget,
	getDeployTargetErrors,
	getRsyncShellCommand,
	getSshDestination,
	getSshOptionArgs,
	normalizeRemotePath,
	normalizeRemoteUrl,
	parseDeployTarget,
	shellQuote,
	splitUserHost,
} from '../deploy-target';

const VALID = {
	host: 'example.com',
	remotePath: '/var/www/site',
	remoteUrl: 'https://example.com',
};

describe( 'splitUserHost', () => {
	it( 'splits the user off a user@host value', () => {
		expect( splitUserHost( 'deploy@example.com' ) ).toEqual( {
			user: 'deploy',
			host: 'example.com',
		} );
	} );

	it( 'leaves a bare host alone', () => {
		expect( splitUserHost( 'example.com' ) ).toEqual( { host: 'example.com' } );
	} );

	it( 'leaves an ssh config alias alone', () => {
		expect( splitUserHost( 'runcloud-prod' ) ).toEqual( { host: 'runcloud-prod' } );
	} );
} );

describe( 'normalizeRemotePath', () => {
	it( 'strips trailing slashes', () => {
		expect( normalizeRemotePath( '/var/www/site///' ) ).toBe( '/var/www/site' );
	} );

	it( 'keeps the root as a single slash', () => {
		expect( normalizeRemotePath( '/' ) ).toBe( '/' );
	} );
} );

describe( 'normalizeRemoteUrl', () => {
	it( 'strips a trailing slash', () => {
		expect( normalizeRemoteUrl( 'https://example.com/' ) ).toBe( 'https://example.com' );
	} );

	it( 'assumes https when no scheme is given', () => {
		expect( normalizeRemoteUrl( 'example.com' ) ).toBe( 'https://example.com' );
	} );

	it( 'keeps an explicit http scheme', () => {
		expect( normalizeRemoteUrl( 'http://example.com' ) ).toBe( 'http://example.com' );
	} );
} );

describe( 'getDeployTargetErrors', () => {
	it( 'accepts a complete target', () => {
		expect( getDeployTargetErrors( VALID ) ).toEqual( {} );
	} );

	it( 'requires a host', () => {
		expect( getDeployTargetErrors( { ...VALID, host: '  ' } ).host ).toMatch( /hostname/i );
	} );

	it( 'rejects a host with spaces', () => {
		expect( getDeployTargetErrors( { ...VALID, host: 'my server' } ).host ).toMatch( /spaces/i );
	} );

	it( 'requires an absolute remote path', () => {
		expect( getDeployTargetErrors( { ...VALID, remotePath: 'www/site' } ).remotePath ).toMatch(
			/absolute/i
		);
	} );

	it( 'accepts a home-relative remote path', () => {
		expect( getDeployTargetErrors( { ...VALID, remotePath: '~/webapps/site' } ) ).toEqual( {} );
	} );

	it( 'refuses the filesystem root', () => {
		expect( getDeployTargetErrors( { ...VALID, remotePath: '/' } ).remotePath ).toMatch( /root/i );
	} );

	it( 'rejects a port outside the valid range', () => {
		expect( getDeployTargetErrors( { ...VALID, port: 0 } ).port ).toBeDefined();
		expect( getDeployTargetErrors( { ...VALID, port: 70000 } ).port ).toBeDefined();
		expect( getDeployTargetErrors( { ...VALID, port: 2222 } ).port ).toBeUndefined();
	} );

	it( 'rejects an unusable remote URL', () => {
		expect( getDeployTargetErrors( { ...VALID, remoteUrl: 'http://' } ).remoteUrl ).toBeDefined();
	} );
} );

describe( 'parseDeployTarget', () => {
	it( 'normalizes and returns a usable target', () => {
		const target = parseDeployTarget( {
			host: 'example.com',
			remotePath: '/var/www/site/',
			remoteUrl: 'example.com/',
		} );

		expect( target ).toEqual( {
			host: 'example.com',
			remotePath: '/var/www/site',
			remoteUrl: 'https://example.com',
		} );
	} );

	it( 'moves a user given as part of the host into its own field', () => {
		expect( parseDeployTarget( { ...VALID, host: 'deploy@example.com' } ) ).toMatchObject( {
			host: 'example.com',
			user: 'deploy',
		} );
	} );

	it( 'keeps an explicit user over one in the host', () => {
		expect(
			parseDeployTarget( { ...VALID, host: 'deploy@example.com', user: 'other' } )
		).toMatchObject( { user: 'other' } );
	} );

	it( 'throws on the first problem it finds', () => {
		expect( () =>
			parseDeployTarget( { remotePath: '/var/www', remoteUrl: 'https://x.test' } )
		).toThrow( DeployTargetError );
	} );

	it( 'drops blank optional fields rather than storing empty strings', () => {
		const target = parseDeployTarget( { ...VALID, user: '  ', identityFile: '' } );

		expect( target.user ).toBeUndefined();
		expect( target.identityFile ).toBeUndefined();
	} );
} );

describe( 'ssh arguments', () => {
	it( 'omits the user when none is set', () => {
		expect( getSshDestination( parseDeployTarget( VALID ) ) ).toBe( 'example.com' );
	} );

	it( 'includes the user when one is set', () => {
		expect( getSshDestination( parseDeployTarget( { ...VALID, user: 'deploy' } ) ) ).toBe(
			'deploy@example.com'
		);
	} );

	it( 'passes the port and key through to ssh', () => {
		const target = parseDeployTarget( { ...VALID, port: 2222, identityFile: '/keys/id_ed25519' } );

		expect( getSshOptionArgs( target ) ).toEqual( [ '-p', '2222', '-i', '/keys/id_ed25519' ] );
	} );

	it( 'passes nothing extra when the ssh config supplies everything', () => {
		expect( getSshOptionArgs( parseDeployTarget( VALID ) ) ).toEqual( [] );
	} );

	it( 'builds the transport command rsync runs through a shell', () => {
		const target = parseDeployTarget( { ...VALID, port: 2222, identityFile: '/my keys/id' } );

		expect( getRsyncShellCommand( target ) ).toBe( "ssh -p 2222 -i '/my keys/id'" );
	} );
} );

describe( 'shellQuote', () => {
	it( 'quotes a plain value', () => {
		expect( shellQuote( '/var/www' ) ).toBe( "'/var/www'" );
	} );

	it( 'escapes an embedded single quote', () => {
		expect( shellQuote( "it's" ) ).toBe( "'it'\\''s'" );
	} );

	it( 'contains a command substitution attempt rather than running it', () => {
		expect( shellQuote( '$(rm -rf /)' ) ).toBe( "'$(rm -rf /)'" );
	} );
} );

describe( 'describeDeployTarget', () => {
	it( 'reads as one line for a log or a prompt', () => {
		const target = parseDeployTarget( { ...VALID, user: 'deploy' } );

		expect( describeDeployTarget( target ) ).toBe(
			'deploy@example.com:/var/www/site (https://example.com)'
		);
	} );
} );
