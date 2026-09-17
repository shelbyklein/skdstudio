import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import PasswordControl from 'src/components/password-control';
import TextControl from 'src/components/text-control';
import { useConfirmationDialog } from 'src/hooks/use-confirmation-dialog';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	useDeleteLicenseMutation,
	useGetLicensesQuery,
	useSaveLicenseMutation,
} from 'src/stores/installed-apps-api';
import { SettingsFormField } from './settings-form-field';

export const LicensesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const { data, isLoading } = useGetLicensesQuery();
	const [ saveLicense, { isLoading: isSaving } ] = useSaveLicenseMutation();
	const [ deleteLicense ] = useDeleteLicenseMutation();

	const [ slug, setSlug ] = useState( '' );
	const [ label, setLabel ] = useState( '' );
	const [ key, setKey ] = useState( '' );
	const [ error, setError ] = useState< string >();

	const confirmDelete = useConfirmationDialog( {
		message: __( 'Remove this license key?' ),
		detail: __(
			'Sites you already created keep the key that was applied to them. New sites will be created without it.'
		),
		confirmButtonLabel: __( 'Remove' ),
		type: 'warning',
	} );

	const licenses = data?.licenses ?? [];
	const isAvailable = data?.available ?? false;
	const canAdd = isAvailable && slug.trim() !== '' && key.trim() !== '' && ! isSaving;

	const handleAdd = async () => {
		setError( undefined );
		try {
			await saveLicense( { slug: slug.trim(), label: label.trim(), key: key.trim() } ).unwrap();
			setSlug( '' );
			setLabel( '' );
			setKey( '' );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
	};

	const handleDelete = ( licenseSlug: string ) => {
		void confirmDelete( () => {
			void deleteLicense( licenseSlug );
		} );
	};

	return (
		<>
			<p className="text-frame-text-secondary">
				{ __(
					'License keys are encrypted with your operating system keychain. A Blueprint refers to a key by name, so the Blueprint itself stays safe to share.'
				) }
			</p>

			{ ! isLoading && ! isAvailable && (
				<div className="p-3 rounded-sm border border-frame-error text-frame-error">
					{ __(
						'This system has no keyring available, so license keys cannot be stored. Studio will not write them to disk unencrypted.'
					) }
				</div>
			) }

			<SettingsFormField label={ __( 'Stored licenses' ) }>
				{ licenses.length === 0 ? (
					<p className="text-frame-text-secondary">{ __( 'No license keys stored yet.' ) }</p>
				) : (
					<ul className="flex flex-col gap-2">
						{ licenses.map( ( license ) => (
							<li
								key={ license.slug }
								className="flex items-center justify-between gap-3 p-3 rounded-sm border border-frame-border bg-frame-surface"
							>
								<div className="min-w-0">
									<div className="font-semibold truncate">{ license.label || license.slug }</div>
									<code className="text-frame-text-secondary break-all">
										{ `\${studio.license:${ license.slug }}` }
									</code>
								</div>
								<Button variant="tertiary" onClick={ () => handleDelete( license.slug ) }>
									{ __( 'Remove' ) }
								</Button>
							</li>
						) ) }
					</ul>
				) }
			</SettingsFormField>

			<SettingsFormField label={ __( 'Add a license' ) }>
				<div className="grid grid-cols-2 gap-3">
					<TextControl
						label={ __( 'Name' ) }
						value={ slug }
						onChange={ setSlug }
						placeholder="bricks"
						disabled={ ! isAvailable }
					/>
					<TextControl
						label={ __( 'Description' ) }
						value={ label }
						onChange={ setLabel }
						placeholder={ __( 'Bricks Builder' ) }
						disabled={ ! isAvailable }
					/>
				</div>
				<PasswordControl
					value={ key }
					onChange={ setKey }
					placeholder={ __( 'License key' ) }
					disabled={ ! isAvailable }
				/>
				{ error && <div className="text-frame-error">{ error }</div> }
				<div className="flex justify-end">
					<Button variant="secondary" onClick={ handleAdd } disabled={ ! canAdd }>
						{ isSaving ? __( 'Saving…' ) : __( 'Add license' ) }
					</Button>
				</div>
			</SettingsFormField>

			<div className="mt-auto pt-2 flex justify-between gap-3">
				<Button
					variant="link"
					onClick={ () =>
						void getIpcApi().openURL(
							'https://github.com/shelbyklein/skdstudio/blob/main/docs/design-docs/licenses.md'
						)
					}
				>
					{ __( 'How to use a license in a Blueprint' ) }
				</Button>
				<Button variant="tertiary" onClick={ onClose }>
					{ __( 'Close' ) }
				</Button>
			</div>
		</>
	);
};
