import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useCallback, useEffect } from 'react';
import CustomTitlebar from 'src/components/custom-titlebar';
import MacTitlebar from 'src/components/mac-titlebar';
import MainSidebar from 'src/components/main-sidebar';
import { NoStudioSites } from 'src/components/no-studio-sites';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import TopBar from 'src/components/top-bar';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useLocalizationSupport } from 'src/hooks/use-localization-support';
import { useSidebarResize } from 'src/hooks/use-sidebar-resize';
import { useSidebarVisibility } from 'src/hooks/use-sidebar-visibility';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isLinux, isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { UserSettings } from 'src/modules/user-settings';
import 'src/index.css';

export default function App() {
	useLocalizationSupport();
	const { isSidebarVisible, toggleSidebar } = useSidebarVisibility();
	const { sidebarWidth, isDragging, handleMouseDown } = useSidebarResize(
		isSidebarVisible,
		toggleSidebar
	);
	const { sites: localSites, loadingSites } = useSiteDetails();
	const isEmpty = ! loadingSites && ! localSites.length;
	const canToggleSidebar = ! isEmpty;
	const handleToggleSidebarShortcut = useCallback( () => {
		if ( canToggleSidebar ) {
			toggleSidebar();
		}
	}, [ canToggleSidebar, toggleSidebar ] );
	useIpcListener( 'toggle-sidebar', handleToggleSidebarShortcut );

	useEffect( () => {
		void getIpcApi().setupAppMenu( {} );
	}, [] );

	return (
		<>
			{ isEmpty ? (
				<VStack className="h-screen backdrop-blur-3xl app-drag-region select-none" spacing="0">
					{ ( isWindows() || isLinux() ) && (
						<CustomTitlebar className="h-titlebar-win flex-shrink-0" />
					) }
					<NoStudioSites />
				</VStack>
			) : (
				<VStack
					className={ cx(
						'h-screen bg-chrome backdrop-blur-3xl ltr:pr-chrome rtl:pl-chrome app-drag-region select-none',
						( isWindows() || isLinux() ) && 'pt-0 pb-chrome',
						! ( isWindows() || isLinux() ) && 'py-chrome'
					) }
					spacing="0"
				>
					{ isWindows() || isLinux() ? (
						<CustomTitlebar className="h-titlebar-win flex-shrink-0">
							<TopBar onToggleSidebar={ toggleSidebar } />
						</CustomTitlebar>
					) : (
						<MacTitlebar className="flex-shrink-0">
							<TopBar onToggleSidebar={ toggleSidebar } />
						</MacTitlebar>
					) }

					<HStack spacing="0" alignment="left" className="flex-grow">
						<MainSidebar
							className={ cx(
								'h-full flex-shrink-0',
								! isDragging && 'transition-all duration-500',
								! isSidebarVisible && 'basis-0 !min-w-[10px]'
							) }
							style={ isSidebarVisible ? { flexBasis: `${ sidebarWidth }px` } : undefined }
						/>
						{ /* Resize handle */ }
						<div
							className="group h-full w-3 cursor-col-resize flex-shrink-0 z-20 flex items-stretch justify-start -ml-1.5 -mr-1.5"
							onMouseDown={ handleMouseDown }
						>
							<div
								className={ cx(
									'w-[3px] rounded-[2px] transition-opacity duration-150 bg-frame-theme',
									isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
								) }
							/>
						</div>
						{ isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" /> }
						<main
							data-testid="site-content"
							className="bg-frame text-frame-text h-full flex-grow rounded-chrome overflow-hidden z-10"
						>
							<SiteContentTabs />
						</main>
					</HStack>
				</VStack>
			) }
			<UserSettings />
		</>
	);
}
