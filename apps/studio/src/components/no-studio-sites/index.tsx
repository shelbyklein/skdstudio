import { useAddSite } from 'src/hooks/use-add-site';
import { AddSiteModalContent } from 'src/modules/add-site';

export function NoStudioSites() {
	const addSiteProps = useAddSite();

	return (
		<main className="bg-frame text-frame-text h-full flex flex-col overflow-hidden z-10">
			<div className="flex-1 min-h-0 w-full pt-14 px-6 pb-6 overflow-y-auto">
				<AddSiteModalContent addSiteProps={ addSiteProps } />
			</div>
		</main>
	);
}
