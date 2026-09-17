import { useI18n } from '@wordpress/react-i18n';
import { ActionButton } from 'src/components/action-button';
import { Tooltip } from 'src/components/tooltip';
import { useImportExport } from 'src/hooks/use-import-export';

export interface SiteManagementActionProps {
	onStop: ( id: string ) => Promise< void >;
	onStart: ( site: SiteDetails ) => Promise< void | { capacityLimitReached: boolean } >;
	selectedSite?: SiteDetails | null;
	loading: boolean;
}

export const SiteManagementActions = ( {
	onStart,
	onStop,
	loading,
	selectedSite,
}: SiteManagementActionProps ) => {
	const { __ } = useI18n();
	const { isSiteImporting } = useImportExport();

	if ( ! selectedSite ) {
		return null;
	}

	const isImporting = isSiteImporting( selectedSite.id );

	return (
		<div className="flex gap-2">
			<Tooltip
				disabled={ ! isImporting }
				text={ __( "A site can't be stopped or started during import." ) }
				placement="left"
			>
				<ActionButton
					isRunning={ selectedSite.running }
					isLoading={ loading }
					onClick={ () => {
						if ( selectedSite.running ) {
							void onStop( selectedSite.id );
						} else {
							void onStart( selectedSite );
						}
					} }
					disabled={ isImporting }
					buttonLabelOnDisabled={ __( 'Importing…' ) }
				/>
			</Tooltip>
		</div>
	);
};
