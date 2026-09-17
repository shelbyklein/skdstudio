import { MenuItem } from '@wordpress/components';
import { useSiteDetails } from 'src/hooks/use-site-details';

type SettingsMenuItemProps = {
	onClick: () => void;
	children: React.ReactNode;
	isDestructive?: boolean;
};

export const SettingsMenuItem = ( {
	onClick,
	children,
	isDestructive = false,
}: SettingsMenuItemProps ) => {
	const { isDeleting, sites, selectedSite } = useSiteDetails();
	if ( ! selectedSite ) {
		return null;
	}
	const isAddingSite = sites.some( ( site ) => site.isAddingSite );
	const isDisabled = isDeleting || isAddingSite;

	return (
		<MenuItem
			className="flex"
			aria-disabled={ isDisabled }
			onClick={ () => {
				if ( isDisabled ) {
					return;
				}
				onClick();
			} }
			isDestructive={ isDestructive }
			disabled={ isDisabled }
		>
			{ children }
		</MenuItem>
	);
};
