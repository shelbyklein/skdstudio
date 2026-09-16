import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Modal from 'src/components/modal';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { cx } from 'src/lib/cx';
import { PreferencesTab } from 'src/modules/user-settings/components/preferences-tab';

export default function UserSettings() {
	const { __ } = useI18n();
	const [ needsToOpenUserSettings, setNeedsToOpenUserSettings ] = useState( false );

	const resetLocalState = useCallback( () => {
		setNeedsToOpenUserSettings( false );
	}, [] );

	useIpcListener( 'user-settings', () => {
		setNeedsToOpenUserSettings( true );
	} );

	return (
		<>
			{ needsToOpenUserSettings && (
				<Modal
					title={ __( 'Settings' ) }
					isDismissible
					onRequestClose={ resetLocalState }
					size="medium"
					className={ cx( 'min-h-[350px]', '[&_[role="document"]]:px-0', 'app-no-drag-region' ) }
				>
					<div className="mt-2 px-8 pb-8 flex gap-4 flex-col">
						<PreferencesTab onClose={ resetLocalState } />
					</div>
				</Modal>
			) }
		</>
	);
}
