import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Modal from 'src/components/modal';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { cx } from 'src/lib/cx';
import { LicensesTab } from 'src/modules/user-settings/components/licenses-tab';
import { PreferencesTab } from 'src/modules/user-settings/components/preferences-tab';
import type { UserSettingsTabName } from 'src/modules/user-settings/user-settings-types';

export default function UserSettings() {
	const { __ } = useI18n();
	const [ needsToOpenUserSettings, setNeedsToOpenUserSettings ] = useState( false );
	const [ activeTab, setActiveTab ] = useState< UserSettingsTabName >( 'general' );

	const resetLocalState = useCallback( () => {
		setNeedsToOpenUserSettings( false );
		setActiveTab( 'general' );
	}, [] );

	useIpcListener( 'user-settings', ( _event, { tabName } = {} ) => {
		setActiveTab( tabName === 'licenses' ? 'licenses' : 'general' );
		setNeedsToOpenUserSettings( true );
	} );

	const tabs: { name: UserSettingsTabName; title: string }[] = [
		{ name: 'general', title: __( 'General' ) },
		{ name: 'licenses', title: __( 'Licenses' ) },
	];

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
					<div className="mt-2 px-8 flex gap-4 border-b border-frame-border">
						{ tabs.map( ( tab ) => (
							<button
								key={ tab.name }
								type="button"
								onClick={ () => setActiveTab( tab.name ) }
								aria-current={ activeTab === tab.name }
								className={ cx(
									'pb-2 -mb-px border-b-2 border-transparent text-frame-text-secondary',
									activeTab === tab.name && 'border-frame-theme text-frame-text font-semibold'
								) }
								data-testid={ `user-settings-tab-${ tab.name }` }
							>
								{ tab.title }
							</button>
						) ) }
					</div>
					<div className="mt-4 px-8 pb-8 flex gap-4 flex-col">
						{ activeTab === 'general' ? (
							<PreferencesTab onClose={ resetLocalState } />
						) : (
							<LicensesTab onClose={ resetLocalState } />
						) }
					</div>
				</Modal>
			) }
		</>
	);
}
