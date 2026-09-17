import * as path from 'path';
import { test, expect } from '@playwright/test';
import fs from 'fs-extra';
import { DEFAULT_SITE_NAME } from './constants';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';

/**
 * Projects are sidebar folders stored in `app.json`. These tests drive the parts a unit test
 * cannot reach: that a real app renders the grouping, that dragging a site into a project actually
 * moves it, and that both survive a restart.
 *
 * The project is seeded into `app.json` rather than created through the UI, because a project is
 * created from a native context menu that Playwright cannot open.
 */
test.describe( 'Projects', () => {
	// These build on each other — drag, then restart, then collapse — against one shared app.
	test.describe.configure( { mode: 'serial' } );

	const session = new E2ESession();

	const appConfigPath = () => path.join( session.sharedConfigPath, 'app.json' );

	async function readAppConfig() {
		return JSON.parse( await fs.readFile( appConfigPath(), 'utf8' ) );
	}

	const siteButton = () =>
		session.mainWindow.getByRole( 'button', { name: DEFAULT_SITE_NAME, exact: true } );
	const projectHeader = () => session.mainWindow.getByRole( 'button', { name: /SDHQ/ } );
	const projectSection = () => session.mainWindow.getByRole( 'region', { name: 'SDHQ' } );

	test.beforeAll( async () => {
		await session.launch();
		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();
		// The sidebar lists a site as soon as creation starts, so wait for the site itself to be
		// ready — closing the app mid-creation kills the CLI child that is building it.
		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );

		// Seed an empty project, then restart so the app reads it back from disk.
		const config = await readAppConfig();
		config.projects = [ { id: 'e2e-project', name: 'SDHQ', sortOrder: 1000 } ];
		await fs.writeFile( appConfigPath(), JSON.stringify( config, null, 2 ) + '\n', 'utf8' );
		await session.restart();
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'shows an empty project as a drop target, with the site still ungrouped', async () => {
		await expect( projectSection() ).toBeVisible( { timeout: 120_000 } );
		await expect( session.mainWindow.getByText( 'Drop sites here' ) ).toBeVisible();
		await expect(
			projectSection().getByRole( 'button', { name: DEFAULT_SITE_NAME, exact: true } )
		).toHaveCount( 0 );
	} );

	test( 'moves a site into a project by dragging it onto the header', async () => {
		await siteButton().dragTo( projectHeader() );

		await expect(
			projectSection().getByRole( 'button', { name: DEFAULT_SITE_NAME, exact: true } )
		).toBeVisible();
		await expect( session.mainWindow.getByText( 'Drop sites here' ) ).toBeHidden();

		// The move is debounced before it is written, so poll rather than reading once.
		await expect
			.poll(
				async () => {
					const config = await readAppConfig();
					return Object.values( config.siteMetadata ?? {} ).some(
						( metadata ) => ( metadata as { projectId?: string } ).projectId === 'e2e-project'
					);
				},
				{ timeout: 10_000 }
			)
			.toBe( true );
	} );

	test( 'keeps the site in its project across a restart', async () => {
		await session.restart();

		await expect( projectSection() ).toBeVisible( { timeout: 120_000 } );
		await expect(
			projectSection().getByRole( 'button', { name: DEFAULT_SITE_NAME, exact: true } )
		).toBeVisible();
	} );

	test( 'collapses a project, and stays collapsed after a restart', async () => {
		await projectHeader().click();
		await expect( siteButton() ).toBeHidden();

		await expect
			.poll( async () => ( await readAppConfig() ).projects?.[ 0 ]?.collapsed, { timeout: 10_000 } )
			.toBe( true );

		await session.restart();

		await expect( projectHeader() ).toBeVisible( { timeout: 120_000 } );
		await expect( siteButton() ).toBeHidden();
	} );
} );
