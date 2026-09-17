import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, ReactNode } from 'react';
import Button from 'src/components/button';
import { useStepper } from '../hooks/use-stepper';

interface StepperProps {
	currentPath?: string;
	onBack?: () => void;
	onBlueprintContinue?: () => void;
	onCreateSubmit?: ( event: FormEvent ) => void;
	canSubmitBlueprint?: boolean;
	canSubmitCreate?: boolean;
	leftSlot?: ReactNode;
}

export default function Stepper( {
	currentPath,
	onBack,
	onBlueprintContinue,
	onCreateSubmit,
	canSubmitBlueprint,
	canSubmitCreate,
	leftSlot,
}: StepperProps ) {
	const { __ } = useI18n();
	const { isVisible, actionButton, onSubmit, canSubmit } = useStepper( {
		onBlueprintContinue,
		onCreateSubmit,
		canSubmitBlueprint,
		canSubmitCreate,
	} );

	if ( ! isVisible ) {
		return null;
	}

	return (
		<>
			<div
				aria-hidden="true"
				className="absolute bottom-0 left-0 right-0 h-14 z-[5] pointer-events-none bg-gradient-to-t from-frame via-frame/90 to-transparent"
			/>
			{ leftSlot && <div className="absolute bottom-5 left-5 z-10">{ leftSlot }</div> }
			<div className="absolute bottom-5 right-5 z-10 flex items-center gap-4">
				{ currentPath && currentPath !== '/' && onBack && (
					<Button variant="secondary" onClick={ onBack } className="!bg-frame">
						{ __( 'Back' ) }
					</Button>
				) }
				{ actionButton?.isVisible && onSubmit && (
					<Button
						variant="primary"
						type="button"
						onClick={ onSubmit }
						disabled={ ! canSubmit }
						data-testid="stepper-action-button"
					>
						{ actionButton.label }
					</Button>
				) }
			</div>
		</>
	);
}
