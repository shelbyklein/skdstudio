import * as path from 'path';
import { test, expect } from '@playwright/test';
import fs from 'fs-extra';
import { DEFAULT_SITE_NAME } from './constants';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';

/**
 * Projects are sidebar folders stored in `app.json`. Their moving parts are covered by unit tests;
 * what only an end-to-end run can show is that a real app reads that file back and renders the
 * grouping — and keeps it across a restart.
 *
 * The project is written straight into `app.json` rather than created through the UI, because a
 * project is created from a native context menu that Playwright cannot drive.
 */
test.describe( 'Projects', () => {
	const session = new E2ESession();

	const appConfigPath = () => path.join( session.sharedConfigPath, 'app.json' );

	async function readAppConfig() {
		return JSON.parse( await fs.readFile( appConfigPath(), 'utf8' ) );
	}

	test.beforeAll( async () => {
		await session.launch();
		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();
		// The sidebar lists a site as soon as creation starts, so wait for the site itself to be
		// ready — closing the app mid-creation kills the CLI child that is building it.
		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'groups a site under its project and keeps it across a restart', async () => {
		// Sites are the CLI's, so the id comes from cli.json; app.json only carries Studio's own
		// metadata for them, and may not mention a site at all until Studio records something.
		const cliConfig = JSON.parse(
			await fs.readFile( path.join( session.cliConfigPath, 'cli.json' ), 'utf8' )
		);
		const siteId = cliConfig.sites?.[ 0 ]?.id;
		expect( siteId ).toBeTruthy();

		const config = await readAppConfig();
		config.projects = [ { id: 'e2e-project', name: 'SDHQ', sortOrder: 1000 } ];
		config.siteMetadata = {
			...config.siteMetadata,
			[ siteId ]: { ...config.siteMetadata?.[ siteId ], projectId: 'e2e-project' },
		};
		await fs.writeFile( appConfigPath(), JSON.stringify( config, null, 2 ) + '\n', 'utf8' );

		// `restart` closes the app and relaunches it, so the edit above is read back from disk.
		// Studio's own writes load-merge-save, so they preserve the keys added here.
		await session.restart();

		// The site is inside the project's section, not loose in the sidebar.
		const section = session.mainWindow.getByRole( 'region', { name: 'SDHQ' } );
		await expect( section ).toBeVisible( { timeout: 120_000 } );
		await expect(
			section.getByRole( 'button', { name: DEFAULT_SITE_NAME, exact: true } )
		).toBeVisible();

		// Collapsing hides the site, and is itself persisted.
		await session.mainWindow.getByRole( 'button', { name: /SDHQ/ } ).click();
		await expect(
			session.mainWindow.getByRole( 'button', { name: DEFAULT_SITE_NAME, exact: true } )
		).toBeHidden();

		await expect
			.poll( async () => ( await readAppConfig() ).projects?.[ 0 ]?.collapsed, {
				timeout: 10_000,
			} )
			.toBe( true );

		await session.restart();

		await expect( session.mainWindow.getByRole( 'button', { name: /SDHQ/ } ) ).toBeVisible( {
			timeout: 120_000,
		} );
		await expect(
			session.mainWindow.getByRole( 'button', { name: DEFAULT_SITE_NAME, exact: true } )
		).toBeHidden();
	} );
} );
