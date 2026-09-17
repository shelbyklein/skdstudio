import { type Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { type SiteRuntime } from '@studio/common/lib/site-runtime';
import AddSiteModal from './add-site-modal';

/**
 * Drives the first-launch screen. With no sites yet, Studio shows the add-site
 * flow directly, so "onboarding" here just means creating the first site.
 */
export default class Onboarding {
	constructor( private page: Page ) {}

	get heading() {
		return this.page.getByRole( 'heading', { name: 'Add a site' } );
	}

	async completeOnboarding( options?: {
		customSiteName?: string;
		customFolderName?: string;
		runtime?: SiteRuntime;
	} ) {
		const { customSiteName, customFolderName, runtime } = options ?? {};

		await expect( this.heading ).toBeVisible();
		const modal = new AddSiteModal( this.page );
		await modal.createSiteButton.click();

		const emptySiteButton = this.page.getByRole( 'button', { name: /Empty site/ } );
		if ( await emptySiteButton.isVisible( { timeout: 2000 } ).catch( () => false ) ) {
			await emptySiteButton.click();
			await modal.continueButton.click();
		}

		if ( customSiteName ) {
			await modal.siteNameInput.fill( customSiteName );
		}
		await expect( modal.siteNameInput ).toHaveValue( /\S+/, { timeout: 5000 } );
		const siteName = await modal.siteNameInput.inputValue();

		if ( customFolderName ) {
			await modal.selectLocalPathForTesting( customFolderName );
		}
		const localPath = await modal.localPathInput.inputValue();

		if ( runtime ) {
			await modal.selectRuntime( runtime );
		}

		await modal.continueButton.click();

		return {
			siteName,
			localPath,
		};
	}

	// Kept for call-site compatibility: the What's New modal no longer exists.
	async closeWhatsNew() {}
}
