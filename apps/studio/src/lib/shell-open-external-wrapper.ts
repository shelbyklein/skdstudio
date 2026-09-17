import { shell, dialog } from 'electron';
import { __ } from '@wordpress/i18n';
import { getMainWindow } from 'src/main-window';

// This wrapper handles shell.openExternal errors, showing appropriate dialog messages.
export const shellOpenExternalWrapper = async ( url: string ) => {
	try {
		await shell.openExternal( url );
	} catch ( error ) {
		console.error( 'Failed to open external URL:', error );

		let title = '';
		let message = '';
		if ( url.startsWith( 'vscode://file/' ) ) {
			title = __( 'Failed to open Visual Studio Code' );
			message = __(
				'Studio is unable to open Visual Studio Code. Please ensure it is functioning correctly.'
			);
		} else if ( url.startsWith( 'phpstorm://open?file=' ) ) {
			title = __( 'Failed to open PHP Storm' );
			message = __(
				'Studio is unable to open PHPStorm. Please ensure it is functioning correctly.'
			);
		} else {
			title = __( 'Failed to open browser' );
			message = __(
				'Studio is unable to open your default browser. Please ensure it is functioning correctly.'
			);
		}

		const mainWindow = await getMainWindow();
		void dialog.showMessageBox( mainWindow, {
			type: 'error',
			message: title,
			detail: message,
			buttons: [ __( 'OK' ) ],
		} );
	}
};
