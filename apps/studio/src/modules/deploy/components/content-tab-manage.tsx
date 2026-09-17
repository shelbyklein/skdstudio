import { getDeployTargetErrors, type DeployTarget } from '@studio/common/lib/deploy-target';
import { CheckboxControl, Notice, Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import TextControlComponent from 'src/components/text-control';
import { useConfirmationDialog } from 'src/hooks/use-confirmation-dialog';
import { useDeploy } from 'src/modules/deploy/hooks/use-deploy';

interface ContentTabManageProps {
	selectedSite: SiteDetails;
}

type TargetForm = {
	host: string;
	user: string;
	port: string;
	identityFile: string;
	remotePath: string;
	remoteUrl: string;
	deleteRemoved: boolean;
};

const EMPTY_FORM: TargetForm = {
	host: '',
	user: '',
	port: '',
	identityFile: '',
	remotePath: '',
	remoteUrl: '',
	deleteRemoved: true,
};

function toForm( target: DeployTarget | undefined ): TargetForm {
	if ( ! target ) {
		return EMPTY_FORM;
	}
	return {
		host: target.host,
		user: target.user ?? '',
		port: target.port ? String( target.port ) : '',
		identityFile: target.identityFile ?? '',
		remotePath: target.remotePath,
		remoteUrl: target.remoteUrl,
		deleteRemoved: target.deleteRemoved !== false,
	};
}

function toTarget( form: TargetForm ): Partial< DeployTarget > {
	return {
		host: form.host.trim(),
		user: form.user.trim() || undefined,
		port: form.port.trim() ? Number( form.port.trim() ) : undefined,
		identityFile: form.identityFile.trim() || undefined,
		remotePath: form.remotePath.trim(),
		remoteUrl: form.remoteUrl.trim(),
		deleteRemoved: form.deleteRemoved,
	};
}

function Field( {
	label,
	help,
	value,
	placeholder,
	error,
	disabled,
	onChange,
}: {
	label: string;
	help?: string;
	value: string;
	placeholder?: string;
	error?: string;
	disabled?: boolean;
	onChange: ( value: string ) => void;
} ) {
	return (
		<TextControlComponent
			label={ label }
			help={ error ?? help }
			value={ value }
			placeholder={ placeholder }
			disabled={ disabled }
			className={ error ? '[&_.components-base-control\\_\\_help]:!text-frame-error' : undefined }
			onChange={ onChange }
		/>
	);
}

export function ContentTabManage( { selectedSite }: ContentTabManageProps ) {
	const { __ } = useI18n();
	const { getState, deploy, pull, cancel, saveTarget, clearResult } = useDeploy();
	const state = getState( selectedSite.id );

	// The site record catches up a moment later, when the CLI's site-updated
	// event reaches the app, so the just-saved target stands in until it does.
	const [ savedTarget, setSavedTarget ] = useState< DeployTarget | undefined >();
	const target = selectedSite.deployTarget ?? savedTarget;

	const [ form, setForm ] = useState< TargetForm >( () => toForm( target ) );
	const [ isEditing, setIsEditing ] = useState( ! target );
	const [ errors, setErrors ] = useState< Partial< Record< keyof DeployTarget, string > > >( {} );
	const [ saveError, setSaveError ] = useState< string | undefined >();
	const [ isSaving, setIsSaving ] = useState( false );

	// Keyed on the site, not on the target object: the site list is replaced
	// wholesale on every refresh, and resetting on a new object identity would
	// wipe the form out from under someone mid-edit.
	useEffect( () => {
		setSavedTarget( undefined );
		setForm( toForm( selectedSite.deployTarget ) );
		setIsEditing( ! selectedSite.deployTarget );
		setErrors( {} );
		setSaveError( undefined );
		// eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately per-site; see above.
	}, [ selectedSite.id ] );

	const confirmPull = useConfirmationDialog( {
		type: 'warning',
		message: __( 'Replace this local site with the live one?' ),
		detail: target
			? sprintf(
					__(
						'The files and database of this site will be replaced with %s. Local changes you have not deployed will be lost.'
					),
					target.remoteUrl
			  )
			: '',
		confirmButtonLabel: __( 'Pull' ),
	} );

	const confirmDeploy = useConfirmationDialog( {
		type: 'warning',
		message: __( 'Replace the site on your server?' ),
		detail: target
			? sprintf(
					__(
						'The files and the database at %s will be replaced with this local site. Anything added on the server since your last deploy will be lost.'
					),
					target.remoteUrl
			  )
			: '',
		confirmButtonLabel: __( 'Deploy' ),
	} );

	const handleSave = useCallback( async () => {
		const candidate = toTarget( form );
		const fieldErrors = getDeployTargetErrors( candidate );
		setErrors( fieldErrors );
		setSaveError( undefined );

		if ( Object.keys( fieldErrors ).length ) {
			return;
		}

		setIsSaving( true );
		try {
			setSavedTarget( await saveTarget( selectedSite.id, candidate ) );
			setIsEditing( false );
		} catch ( error ) {
			setSaveError( error instanceof Error ? error.message : __( 'Could not save the server.' ) );
		} finally {
			setIsSaving( false );
		}
	}, [ __, form, saveTarget, selectedSite.id ] );

	const handleDeploy = useCallback( () => {
		clearResult( selectedSite.id );
		void confirmDeploy( () => {
			void deploy( selectedSite.id );
		} );
	}, [ clearResult, confirmDeploy, deploy, selectedSite.id ] );

	const handlePushPreview = useCallback( () => {
		clearResult( selectedSite.id );
		void deploy( selectedSite.id, { dryRun: true } );
	}, [ clearResult, deploy, selectedSite.id ] );

	const handlePullPreview = useCallback( () => {
		clearResult( selectedSite.id );
		void pull( selectedSite.id, { dryRun: true } );
	}, [ clearResult, pull, selectedSite.id ] );

	const handlePull = useCallback( () => {
		clearResult( selectedSite.id );
		void confirmPull( () => {
			void pull( selectedSite.id );
		} );
	}, [ clearResult, confirmPull, pull, selectedSite.id ] );

	const isBusy = state.isDeploying;

	return (
		<div className="flex flex-col gap-8 p-8 max-w-[600px]">
			<div className="flex flex-col gap-4">
				<div>
					<h4 className="a8c-subtitle-small leading-5">{ __( 'Server' ) }</h4>
					<p className="text-frame-text-secondary leading-[140%] a8c-helper-text text-[13px]">
						{ __(
							'Studio connects over SSH using your existing keys and ~/.ssh/config, so a server you can already reach from your terminal needs no extra setup here.'
						) }
					</p>
				</div>

				{ isEditing ? (
					<div className="flex flex-col gap-4">
						<Field
							label={ __( 'Host' ) }
							help={ __( 'A hostname, an IP address, or an alias from your SSH config.' ) }
							placeholder="deploy@example.com"
							value={ form.host }
							error={ errors.host }
							disabled={ isBusy }
							onChange={ ( host ) => setForm( ( f ) => ( { ...f, host } ) ) }
						/>
						<div className="grid grid-cols-2 gap-4">
							<Field
								label={ __( 'SSH user' ) }
								help={ __( 'Optional when your SSH config sets one.' ) }
								value={ form.user }
								disabled={ isBusy }
								onChange={ ( user ) => setForm( ( f ) => ( { ...f, user } ) ) }
							/>
							<Field
								label={ __( 'Port' ) }
								help={ __( 'Optional. Defaults to 22.' ) }
								value={ form.port }
								error={ errors.port }
								disabled={ isBusy }
								onChange={ ( port ) => setForm( ( f ) => ( { ...f, port } ) ) }
							/>
						</div>
						<Field
							label={ __( 'Private key' ) }
							help={ __( 'Optional. Leave empty to use your SSH agent.' ) }
							placeholder="~/.ssh/id_ed25519"
							value={ form.identityFile }
							disabled={ isBusy }
							onChange={ ( identityFile ) => setForm( ( f ) => ( { ...f, identityFile } ) ) }
						/>
						<Field
							label={ __( 'Remote path' ) }
							help={ __( 'The WordPress directory on the server.' ) }
							placeholder="/home/runcloud/webapps/mysite"
							value={ form.remotePath }
							error={ errors.remotePath }
							disabled={ isBusy }
							onChange={ ( remotePath ) => setForm( ( f ) => ( { ...f, remotePath } ) ) }
						/>
						<Field
							label={ __( 'Site address' ) }
							help={ __( 'Where the deployed site is served from. URLs are rewritten to match.' ) }
							placeholder="https://example.com"
							value={ form.remoteUrl }
							error={ errors.remoteUrl }
							disabled={ isBusy }
							onChange={ ( remoteUrl ) => setForm( ( f ) => ( { ...f, remoteUrl } ) ) }
						/>
						<CheckboxControl
							__nextHasNoMarginBottom
							label={ __( 'Delete server files that no longer exist locally' ) }
							checked={ form.deleteRemoved }
							disabled={ isBusy }
							onChange={ ( deleteRemoved ) => setForm( ( f ) => ( { ...f, deleteRemoved } ) ) }
						/>

						{ saveError && (
							<Notice status="error" isDismissible={ false }>
								{ saveError }
							</Notice>
						) }

						<div className="flex gap-2">
							<Button variant="primary" onClick={ handleSave } disabled={ isSaving || isBusy }>
								{ isSaving ? __( 'Saving…' ) : __( 'Save server' ) }
							</Button>
							{ target && (
								<Button
									variant="secondary"
									disabled={ isSaving || isBusy }
									onClick={ () => {
										setForm( toForm( target ) );
										setErrors( {} );
										setIsEditing( false );
									} }
								>
									{ __( 'Cancel' ) }
								</Button>
							) }
						</div>
					</div>
				) : (
					target && (
						<div className="flex flex-col gap-3">
							<dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
								<dt className="text-frame-text-secondary">{ __( 'Host' ) }</dt>
								<dd className="break-all">
									{ target.user ? `${ target.user }@${ target.host }` : target.host }
									{ target.port ? `:${ target.port }` : '' }
								</dd>
								<dt className="text-frame-text-secondary">{ __( 'Remote path' ) }</dt>
								<dd className="break-all">{ target.remotePath }</dd>
								<dt className="text-frame-text-secondary">{ __( 'Site address' ) }</dt>
								<dd className="break-all">{ target.remoteUrl }</dd>
							</dl>
							<div>
								<Button variant="link" onClick={ () => setIsEditing( true ) } disabled={ isBusy }>
									{ __( 'Edit server' ) }
								</Button>
							</div>
						</div>
					)
				) }
			</div>

			{ target && ! isEditing && (
				<div className="flex flex-col gap-6">
					{ state.isDeploying ? (
						<div className="flex flex-col gap-3 max-w-[360px]">
							<div className="flex items-center gap-2 text-frame-text-secondary a8c-body">
								<Spinner />
								<span>
									{ state.statusMessage ??
										( state.kind === 'pull' ? __( 'Pulling…' ) : __( 'Pushing…' ) ) }
								</span>
							</div>
							<div>
								<Button variant="secondary" onClick={ () => void cancel( selectedSite.id ) }>
									{ __( 'Stop' ) }
								</Button>
							</div>
						</div>
					) : (
						<>
							<div className="flex flex-col gap-3">
								<div>
									<h4 className="a8c-subtitle-small leading-5">{ __( 'Push' ) }</h4>
									<p className="text-frame-text-secondary leading-[140%] a8c-helper-text text-[13px]">
										{ sprintf(
											__(
												'Send this site’s files and database to %s, rewriting local URLs to the site address.'
											),
											target.remoteUrl
										) }
									</p>
								</div>
								<div className="flex gap-2">
									<Button variant="primary" onClick={ handleDeploy }>
										{ __( 'Push to server' ) }
									</Button>
									<Button variant="secondary" onClick={ handlePushPreview }>
										{ __( 'Preview push' ) }
									</Button>
								</div>
							</div>

							<div className="flex flex-col gap-3">
								<div>
									<h4 className="a8c-subtitle-small leading-5">{ __( 'Pull' ) }</h4>
									<p className="text-frame-text-secondary leading-[140%] a8c-helper-text text-[13px]">
										{ sprintf(
											__(
												'Bring the live site at %s down onto this machine, rewriting its URLs to the local address.'
											),
											target.remoteUrl
										) }
									</p>
								</div>
								<div className="flex gap-2">
									<Button variant="primary" onClick={ handlePull }>
										{ __( 'Pull from server' ) }
									</Button>
									<Button variant="secondary" onClick={ handlePullPreview }>
										{ __( 'Preview pull' ) }
									</Button>
								</div>
							</div>
						</>
					) }

					{ ! state.isDeploying && state.errorMessage && (
						<Notice status="error" isDismissible onRemove={ () => clearResult( selectedSite.id ) }>
							{ state.errorMessage }
						</Notice>
					) }

					{ ! state.isDeploying && state.completedAt && ! state.errorMessage && (
						<Notice
							status="success"
							isDismissible
							onRemove={ () => clearResult( selectedSite.id ) }
						>
							{ state.kind === 'pull'
								? sprintf( __( 'Pulled from %s' ), target.remoteUrl )
								: sprintf( __( 'Pushed to %s' ), target.remoteUrl ) }
						</Notice>
					) }

					{ state.warnings.map( ( warning ) => (
						<Notice key={ warning } status="warning" isDismissible={ false }>
							{ warning }
						</Notice>
					) ) }

					<p className="text-frame-text-secondary text-xs">
						{ __(
							'Each side keeps its own wp-config.php. Add a .deployignore file to the site directory to keep files out of both directions.'
						) }
					</p>
				</div>
			) }
		</div>
	);
}
