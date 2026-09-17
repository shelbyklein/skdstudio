/**
 * @vitest-environment node
 *
 * Exercises `studio server set|show|forget` against the built CLI and a real
 * `cli.json`. The site record is seeded directly rather than created, because
 * these commands only read and write configuration.
 *
 * Needs the CLI built first (skips otherwise). Tagged `e2e`:
 * `npm run test:cli-e2e`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
	type CliEnv,
} from 'cli/commands/site/tests/helpers/cli-e2e';

function seedSite( env: CliEnv, sitePath: string ): void {
	fs.mkdirSync( sitePath, { recursive: true } );
	fs.writeFileSync(
		env.cliConfigPath,
		JSON.stringify( {
			version: 1,
			lastDependencyCheckTime: Date.now(),
			sites: [
				{
					id: 'deploy-test-site',
					name: 'Deploy test',
					path: sitePath,
					port: 8881,
					url: 'http://localhost:8881',
					phpVersion: '8.4',
				},
			],
		} )
	);
}

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio server configuration', () => {
	let env: CliEnv;
	let sitePath: string;

	beforeEach( () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'deploy-test' );
		seedSite( env, sitePath );
	} );

	afterEach( () => {
		cleanupCliEnv( env );
	} );

	it( 'reports that no server is set up yet', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
		const result = await runCli( [ 'server', 'show', '--path', sitePath ], env );

		expect( result.code, result.stderr ).toBe( 0 );
		expect( result.stdout ).toMatch( /no server is set up/i );
	} );

	it( 'saves a server and reads it back', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
		const setResult = await runCli(
			[
				'server',
				'set',
				'--path',
				sitePath,
				'--host',
				'deploy@example.com',
				'--port',
				'2222',
				'--remote-path',
				'/home/deploy/webapps/mysite/',
				'--remote-url',
				'example.com/',
			],
			env
		);

		expect( setResult.code, setResult.stderr ).toBe( 0 );

		// Stored normalized: the user split out, and both trailing slashes gone.
		const stored = readCliConfig( env ).sites[ 0 ].deployTarget as Record< string, unknown >;
		expect( stored ).toMatchObject( {
			host: 'example.com',
			user: 'deploy',
			port: 2222,
			remotePath: '/home/deploy/webapps/mysite',
			remoteUrl: 'https://example.com',
		} );

		const showResult = await runCli( [ 'server', 'show', '--path', sitePath ], env );
		expect( showResult.stdout ).toContain( 'deploy@example.com' );
		expect( showResult.stdout ).toContain( '/home/deploy/webapps/mysite' );
		expect( showResult.stdout ).toContain( 'https://example.com' );
	} );

	it(
		'changes one field without restating the rest',
		{ tags: [ 'e2e' ], timeout: 60_000 },
		async () => {
			await runCli(
				[
					'server',
					'set',
					'--path',
					sitePath,
					'--host',
					'example.com',
					'--remote-path',
					'/var/www/site',
					'--remote-url',
					'https://example.com',
				],
				env
			);

			const result = await runCli(
				[ 'server', 'set', '--path', sitePath, '--remote-url', 'https://staging.example.com' ],
				env
			);

			expect( result.code, result.stderr ).toBe( 0 );
			expect( readCliConfig( env ).sites[ 0 ].deployTarget ).toMatchObject( {
				host: 'example.com',
				remotePath: '/var/www/site',
				remoteUrl: 'https://staging.example.com',
			} );
		}
	);

	it( 'rejects a relative remote path', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
		const result = await runCli(
			[
				'server',
				'set',
				'--path',
				sitePath,
				'--host',
				'example.com',
				'--remote-path',
				'webapps/mysite',
				'--remote-url',
				'https://example.com',
			],
			env
		);

		expect( result.code ).not.toBe( 0 );
		expect( `${ result.stdout }${ result.stderr }` ).toMatch( /absolute/i );
		expect( readCliConfig( env ).sites[ 0 ].deployTarget ).toBeUndefined();
	} );

	it(
		'refuses to deploy before a server is set up',
		{ tags: [ 'e2e' ], timeout: 60_000 },
		async () => {
			const result = await runCli( [ 'push', '--path', sitePath, '--yes' ], env );

			expect( result.code ).not.toBe( 0 );
			expect( `${ result.stdout }${ result.stderr }` ).toMatch( /no server set up/i );
		}
	);

	it(
		'still accepts the deploy alias older scripts use',
		{ tags: [ 'e2e' ], timeout: 60_000 },
		async () => {
			const result = await runCli(
				[
					'deploy',
					'set',
					'--path',
					sitePath,
					'--host',
					'example.com',
					'--remote-path',
					'/var/www/site',
					'--remote-url',
					'https://example.com',
				],
				env
			);

			expect( result.code, result.stderr ).toBe( 0 );
			expect( readCliConfig( env ).sites[ 0 ].deployTarget ).toMatchObject( {
				host: 'example.com',
			} );
		}
	);

	it( 'forgets a saved server', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
		await runCli(
			[
				'server',
				'set',
				'--path',
				sitePath,
				'--host',
				'example.com',
				'--remote-path',
				'/var/www/site',
				'--remote-url',
				'https://example.com',
			],
			env
		);

		const result = await runCli( [ 'server', 'forget', '--path', sitePath ], env );

		expect( result.code, result.stderr ).toBe( 0 );
		expect( readCliConfig( env ).sites[ 0 ].deployTarget ).toBeUndefined();
	} );
} );
