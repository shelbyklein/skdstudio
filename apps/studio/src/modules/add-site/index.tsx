import {
	DEFAULT_PHP_VERSION,
	DEFAULT_WORDPRESS_VERSION,
	MINIMUM_WORDPRESS_VERSION,
} from '@studio/common/constants';
import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import { BlueprintPreferredVersions } from '@studio/common/lib/blueprint-validation';
import { isSupportedPHPVersion, SupportedPHPVersion } from '@studio/common/types/php-versions';
import { speak } from '@wordpress/a11y';
import { Navigator, useNavigator } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from 'src/components/button';
import { DotGrid } from 'src/components/dot-grid';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite, CreateSiteFormValues } from 'src/hooks/use-add-site';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector, useAppDispatch } from 'src/stores';
import { openAddSiteModal, closeAddSiteModal, selectIsAddSiteModalOpen } from 'src/stores/ui-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import CreateSite from './components/create-site';
import { NewSiteOptions } from './components/new-site-options';
import AddSiteOptions, { type AddSiteFlowType } from './components/options';
import Stepper from './components/stepper';
import { UploadBlueprintButton } from './components/upload-blueprint-button';
import { useFindAvailableSiteName } from './hooks/use-find-available-site-name';
import { applyBlueprintFormValues } from './lib/apply-blueprint-form-values';
import type { Blueprint } from 'src/lib/blueprint';

// Wrapper for each Navigator.Screen's content.
// - Header and Stepper are both absolute overlays with backdrop-blur, so the
//   Screen always has the full Navigator height regardless of path (no shift).
// - Content centers with small breathing padding. When content is taller than
//   the viewport it scrolls under the frosted overlays.
function ScreenContent( { children }: { children: React.ReactNode } ) {
	return <div className="min-h-full flex flex-col justify-top py-8">{ children }</div>;
}

interface NavigationContentProps {
	startOver: () => void;
	defaultValues: {
		siteName: string;
		sitePath: string;
		phpVersion: SupportedPHPVersion;
		wpVersion: string;
	};
	onSelectPath: ( currentPath: string ) => Promise< {
		path: string;
		name?: string;
		isEmpty: boolean;
		isWordPress: boolean;
		error?: string;
	} | null >;
	onSiteNameChange: ( name: string ) => Promise< {
		path: string;
		isEmpty: boolean;
		isWordPress: boolean;
		error?: string;
	} >;
	existingDomainNames: string[];
	onFormSubmit: ( values: CreateSiteFormValues ) => void;
	onValidityChange: ( isValid: boolean ) => void;
	canSubmit: boolean;
	setFileForImport: ( file: File | null ) => void;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	selectedBlueprint?: Blueprint;
	blueprintPreferredVersions?: BlueprintPreferredVersions;
	setBlueprintPreferredVersions: ( versions: BlueprintPreferredVersions | undefined ) => void;
	blueprintSuggestedDomain?: string;
	setBlueprintSuggestedDomain: ( domain: string | undefined ) => void;
	blueprintSuggestedHttps?: boolean;
	setBlueprintSuggestedHttps: ( https: boolean | undefined ) => void;
	blueprintCredentials?: { adminUsername?: string; adminPassword?: string };
	blueprintSuggestedSiteName?: string;
	setBlueprintSuggestedSiteName: ( name: string | undefined ) => void;
	blueprintRequiresCustomDomain: boolean;
	setBlueprintRequiresCustomDomain: ( requires: boolean ) => void;
	onPathChange: ( path: string | undefined ) => void;
}

function NavigationContent( props: NavigationContentProps ) {
	const { goTo, goBack, location } = useNavigator();
	const { __ } = useI18n();
	const [ blueprintFileError, setBlueprintFileError ] = useState< string | undefined >();
	const [ fileBlueprint, setFileBlueprint ] = useState< Blueprint | undefined >();
	const {
		startOver,
		defaultValues,
		onSelectPath,
		onSiteNameChange,
		existingDomainNames,
		onFormSubmit,
		onValidityChange,
		canSubmit,
		setFileForImport,
		selectedBlueprint,
		setSelectedBlueprint,
		blueprintPreferredVersions,
		setBlueprintPreferredVersions,
		blueprintSuggestedDomain,
		setBlueprintSuggestedDomain,
		blueprintSuggestedHttps,
		setBlueprintSuggestedHttps,
		blueprintCredentials,
		blueprintSuggestedSiteName,
		setBlueprintSuggestedSiteName,
		blueprintRequiresCustomDomain,
		setBlueprintRequiresCustomDomain,
		onPathChange,
	} = props;

	useEffect( () => {
		onPathChange( location.path );
	}, [ location.path, onPathChange ] );

	const handleOptionSelect = useCallback(
		( option: AddSiteFlowType ) => {
			if ( option === 'new' ) {
				goTo( '/new' );
			} else if ( option === 'backup' ) {
				goTo( '/backup/create' );
			}
		},
		[ goTo ]
	);

	const handleBlueprintContinue = useCallback( () => {
		if ( selectedBlueprint ) {
			goTo( '/new/create' );
		}
	}, [ selectedBlueprint, goTo ] );

	const handleBackupFileSelect = useCallback(
		( file?: File ) => {
			setFileForImport( file || null );
		},
		[ setFileForImport ]
	);

	const handleBack = useCallback( () => {
		if ( location.path === '/backup/create' ) {
			setFileForImport( null );
		}
		if ( location.path === '/new' ) {
			setSelectedBlueprint();
			setBlueprintPreferredVersions?.( undefined );
			setBlueprintSuggestedSiteName?.( undefined );
			setBlueprintFileError( undefined );
			setFileBlueprint( undefined );
			startOver();
		}
		goBack();
	}, [
		location.path,
		goBack,
		startOver,
		setFileForImport,
		setSelectedBlueprint,
		setBlueprintPreferredVersions,
		setBlueprintSuggestedSiteName,
	] );

	const handleBlueprintFormValues = useCallback(
		( blueprint?: Blueprint ) => {
			setSelectedBlueprint( blueprint );

			if ( ! blueprint?.blueprint ) {
				setBlueprintPreferredVersions?.( undefined );
				setBlueprintSuggestedDomain?.( undefined );
				setBlueprintSuggestedHttps?.( undefined );
				setBlueprintSuggestedSiteName?.( undefined );
				setBlueprintRequiresCustomDomain( false );
				return;
			}

			applyBlueprintFormValues( blueprint.blueprint, {
				setBlueprintPreferredVersions,
				setBlueprintSuggestedDomain,
				setBlueprintSuggestedHttps,
				setBlueprintSuggestedSiteName,
				setBlueprintRequiresCustomDomain,
			} );
		},
		[
			setSelectedBlueprint,
			setBlueprintPreferredVersions,
			setBlueprintSuggestedDomain,
			setBlueprintSuggestedHttps,
			setBlueprintSuggestedSiteName,
			setBlueprintRequiresCustomDomain,
		]
	);

	const handleBlueprintChange = useCallback(
		( blueprintId: string ) => {
			if ( blueprintId === 'empty' ) {
				setSelectedBlueprint( {
					slug: 'empty',
					title: 'Empty site',
					excerpt: '',
					image: '',
					playground_url: '',
					blueprint: {},
				} as Blueprint );
				return;
			}
			if ( fileBlueprint && fileBlueprint.slug === blueprintId ) {
				handleBlueprintFormValues( fileBlueprint );
			}
		},
		[ fileBlueprint, handleBlueprintFormValues, setSelectedBlueprint ]
	);

	const handleFileBlueprintSelect = useCallback(
		( blueprint: Blueprint ) => {
			setFileBlueprint( blueprint );
			handleBlueprintFormValues( blueprint );
			goTo( '/new/create' );
		},
		[ handleBlueprintFormValues, goTo ]
	);

	// Build default values with blueprint preferred versions applied
	const { data: wpVersions = [] } = useGetWordPressVersions( {
		minimumVersion: MINIMUM_WORDPRESS_VERSION,
	} );
	const defaultValuesWithBlueprint = useMemo( () => {
		const values = { ...defaultValues };
		if ( isSupportedPHPVersion( blueprintPreferredVersions?.php ) ) {
			values.phpVersion = blueprintPreferredVersions.php;
		}
		if (
			blueprintPreferredVersions?.wp &&
			wpVersions.some( ( v ) => v.value === blueprintPreferredVersions.wp )
		) {
			values.wpVersion = blueprintPreferredVersions.wp;
		}
		if ( blueprintSuggestedSiteName ) {
			values.siteName = blueprintSuggestedSiteName;
		}
		return values;
	}, [ defaultValues, blueprintPreferredVersions, blueprintSuggestedSiteName, wpVersions ] );

	const formRef = useRef< HTMLFormElement >( null );

	const createSiteProps = {
		onSelectPath,
		onSiteNameChange,
		existingDomainNames,
		onSubmit: onFormSubmit,
		onValidityChange,
		formRef,
		blueprintCredentials: blueprintCredentials ?? undefined,
	};

	return (
		<>
			<Navigator.Screen className="h-full overflow-y-auto" path="/">
				<ScreenContent>
					<AddSiteOptions
						onOptionSelect={ handleOptionSelect }
						onBackupFileSelect={ ( file ) => {
							handleBackupFileSelect( file );
						} }
					/>
				</ScreenContent>
			</Navigator.Screen>
			<Navigator.Screen className="h-full overflow-y-auto" path="/new">
				<ScreenContent>
					<NewSiteOptions
						selectedBlueprint={ selectedBlueprint?.slug || null }
						fileBlueprint={ fileBlueprint }
						onBlueprintChange={ handleBlueprintChange }
						blueprintFileError={ blueprintFileError }
						uploadButton={
							<UploadBlueprintButton
								onFileBlueprintSelect={ handleFileBlueprintSelect }
								onError={ setBlueprintFileError }
							/>
						}
					/>
				</ScreenContent>
			</Navigator.Screen>
			<Navigator.Screen className="h-full overflow-y-auto" path="/new/create">
				<ScreenContent>
					<CreateSite
						{ ...createSiteProps }
						defaultValues={ defaultValuesWithBlueprint }
						blueprintPreferredVersions={ blueprintPreferredVersions }
						blueprintSuggestedDomain={ blueprintSuggestedDomain }
						blueprintSuggestedHttps={ blueprintSuggestedHttps }
						blueprintRequiresCustomDomain={ blueprintRequiresCustomDomain }
					/>
				</ScreenContent>
			</Navigator.Screen>
			<Navigator.Screen className="h-full overflow-y-auto" path="/backup/create">
				<ScreenContent>
					<CreateSite { ...createSiteProps } defaultValues={ defaultValues } />
				</ScreenContent>
			</Navigator.Screen>
			<Stepper
				currentPath={ location.path }
				onBack={ handleBack }
				onBlueprintContinue={ handleBlueprintContinue }
				onCreateSubmit={ () => {
					formRef.current?.requestSubmit();
				} }
				canSubmitBlueprint={ !! selectedBlueprint }
				canSubmitCreate={ canSubmit }
			/>
		</>
	);
}

interface AddSiteModalContentProps {
	isOpen?: boolean;
	onSubmit?: () => void;
	className?: string;
	addSiteProps: ReturnType< typeof useAddSite >;
}

export function AddSiteModalContent( {
	isOpen = true,
	onSubmit,
	className,
	addSiteProps,
}: AddSiteModalContentProps ) {
	const { __ } = useI18n();
	const [ formInitialized, setFormInitialized ] = useState( false );
	const [ defaultSiteName, setDefaultSiteName ] = useState( '' );
	const [ defaultSitePath, setDefaultSitePath ] = useState( '' );
	const [ isFormValid, setIsFormValid ] = useState( true );
	const [ currentPath, setCurrentPath ] = useState< string | undefined >( undefined );

	const { sites, loadingSites } = useSiteDetails();

	const {
		handleCreateSite,
		selectPath,
		generateProposedPath,
		setFileForImport,
		selectedBlueprint,
		setSelectedBlueprint,
		blueprintPreferredVersions,
		setBlueprintPreferredVersions,
		blueprintSuggestedDomain,
		setBlueprintSuggestedDomain,
		blueprintSuggestedHttps,
		setBlueprintSuggestedHttps,
		blueprintSuggestedSiteName,
		setBlueprintSuggestedSiteName,
		blueprintRequiresCustomDomain,
		setBlueprintRequiresCustomDomain,
		existingDomainNames,
		loadAllCustomDomains,
	} = addSiteProps;

	const { data: versions = [] } = useGetWordPressVersions( {
		minimumVersion: MINIMUM_WORDPRESS_VERSION,
	} );
	const latestStableVersion = versions.find( ( version ) => version.value === 'latest' );

	const initialNavigatorPath = '/';

	// Initialize form with generated site name and path
	useEffect( () => {
		const initializeForm = async () => {
			if ( ! isOpen || formInitialized || loadingSites ) return;

			const generatedSiteName = await getIpcApi().generateSiteNameFromList( sites );
			const { path } = await getIpcApi().generateProposedSitePath( generatedSiteName );

			setDefaultSiteName( generatedSiteName );
			setDefaultSitePath( path );
			setFormInitialized( true );
			loadAllCustomDomains();
		};

		void initializeForm();
	}, [ isOpen, formInitialized, loadingSites, sites, loadAllCustomDomains ] );

	// Update site name and path when blueprint suggests a site name
	const findAvailableSiteName = useFindAvailableSiteName();
	useEffect( () => {
		if ( ! formInitialized || ! blueprintSuggestedSiteName ) {
			return;
		}

		const updatePathForBlueprintName = async () => {
			const availableName = await findAvailableSiteName( blueprintSuggestedSiteName );
			const { path } = await getIpcApi().generateProposedSitePath( availableName );
			setDefaultSiteName( availableName );
			setDefaultSitePath( path );
		};
		void updatePathForBlueprintName();
	}, [ blueprintSuggestedSiteName, formInitialized, findAvailableSiteName ] );

	// Reset form initialized state when modal closes
	useEffect( () => {
		if ( ! isOpen ) {
			setFormInitialized( false );
		}
	}, [ isOpen ] );
	const startOver = useCallback( () => {
		setFormInitialized( false );
	}, [] );

	const defaultValues = useMemo(
		() => ( {
			siteName: defaultSiteName,
			sitePath: defaultSitePath,
			phpVersion: DEFAULT_PHP_VERSION,
			wpVersion: latestStableVersion?.value ?? DEFAULT_WORDPRESS_VERSION,
		} ),
		[ defaultSiteName, defaultSitePath, latestStableVersion ]
	);

	const handleFormSubmit = useCallback(
		async ( values: CreateSiteFormValues ) => {
			const siteAddedMessage = sprintf(
				// translators: %s is the site name.
				__( '%s site added.' ),
				values.siteName
			);

			onSubmit?.();
			await handleCreateSite( values );
			speak( siteAddedMessage );
		},
		[ __, handleCreateSite, onSubmit ]
	);

	// canSubmit is true if the form is initialized, has a name, and is valid (no errors)
	const canSubmit = formInitialized && defaultSiteName.trim().length > 0 && isFormValid;

	// Extract login credentials from blueprint
	const blueprintCredentials = useMemo( () => {
		if ( ! selectedBlueprint?.blueprint ) {
			return undefined;
		}
		const formValues = extractFormValuesFromBlueprint( selectedBlueprint.blueprint );
		if ( formValues.adminUsername || formValues.adminPassword ) {
			return {
				adminUsername: formValues.adminUsername,
				adminPassword: formValues.adminPassword,
			};
		}
		return undefined;
	}, [ selectedBlueprint ] );

	const showDotGrid = ! currentPath || currentPath === '/';

	const sharedNavigationProps = {
		defaultValues,
		onSelectPath: selectPath,
		onSiteNameChange: generateProposedPath,
		existingDomainNames,
		onFormSubmit: handleFormSubmit,
		onValidityChange: setIsFormValid,
		canSubmit,
		setFileForImport,
		selectedBlueprint,
		setSelectedBlueprint,
		blueprintPreferredVersions,
		setBlueprintPreferredVersions,
		blueprintSuggestedDomain,
		setBlueprintSuggestedDomain,
		blueprintSuggestedHttps,
		setBlueprintSuggestedHttps,
		blueprintCredentials,
		blueprintSuggestedSiteName,
		setBlueprintSuggestedSiteName,
		blueprintRequiresCustomDomain,
		setBlueprintRequiresCustomDomain,
		startOver,
	};

	return (
		<>
			<div
				aria-hidden="true"
				className={ cx(
					'fixed inset-0 pointer-events-none z-0 transition-opacity ease-out',
					showDotGrid ? 'opacity-100 duration-500' : 'opacity-0 duration-700'
				) }
			>
				<DotGrid
					spacing={ 32 }
					crossSize={ 5 }
					opacity={ 0.2 }
					className="text-frame-text-secondary"
				/>
			</div>
			<Navigator
				className={ cx( 'relative z-10', className ?? 'w-full h-full app-no-drag-region' ) }
				initialPath={ initialNavigatorPath }
			>
				<NavigationContent { ...sharedNavigationProps } onPathChange={ setCurrentPath } />
			</Navigator>
		</>
	);
}

interface AddSiteModalProps {
	className?: string;
}

export default function AddSiteModal( { className }: AddSiteModalProps ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const showModal = useRootSelector( selectIsAddSiteModalOpen );

	useEffect( () => {
		void getIpcApi().setupAppMenu( { isAddSiteVisible: showModal } );
	}, [ showModal ] );

	const openModal = useCallback( () => {
		dispatch( openAddSiteModal() );
	}, [ dispatch ] );

	const addSiteProps = useAddSite();
	const { resetForm, isAnySiteProcessing } = addSiteProps;

	const closeModal = useCallback( () => {
		resetForm();
		dispatch( closeAddSiteModal() );
	}, [ resetForm, dispatch ] );

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
	} );

	return (
		<>
			<FullscreenModal isOpen={ showModal } onClose={ closeModal }>
				<AddSiteModalContent
					isOpen={ showModal }
					onSubmit={ closeModal }
					addSiteProps={ addSiteProps }
				/>
			</FullscreenModal>
			<Button
				variant="outlined"
				className={ className }
				onClick={ openModal }
				disabled={ isAnySiteProcessing }
				data-testid="add-site-button"
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
