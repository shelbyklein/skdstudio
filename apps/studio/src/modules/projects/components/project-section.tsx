/**
 * One project in the sidebar: a header that collapses, and the sites it holds.
 *
 * Colours here follow the rest of the sidebar, which is always the dark app chrome and uses the
 * `a8c-*` palette and translucent whites rather than the `--color-frame-*` tokens. Those tokens are
 * for the content area, which flips with the colour scheme; this surface does not.
 */
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import type { Project } from 'src/storage/storage-types';

function Chevron( { collapsed }: { collapsed: boolean } ) {
	return (
		<svg
			aria-hidden="true"
			width="8"
			height="8"
			viewBox="0 0 8 8"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={ cx(
				'transition-transform shrink-0',
				collapsed && 'rtl:-rotate-90',
				collapsed ? '-rotate-90' : ''
			) }
		>
			<path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
		</svg>
	);
}

export function ProjectSection( {
	project,
	siteCount,
	hasRunningSite,
	isDragOver,
	isRenaming,
	onToggleCollapsed,
	onRename,
	onRenameCancel,
	onContextMenu,
	onHeaderDragStart,
	onHeaderDragOver,
	onHeaderDrop,
	onDragEnd,
	children,
}: {
	project: Project;
	siteCount: number;
	hasRunningSite: boolean;
	isDragOver: boolean;
	isRenaming: boolean;
	onToggleCollapsed: () => void;
	onRename: ( name: string ) => void;
	onRenameCancel: () => void;
	onContextMenu: ( e: React.MouseEvent ) => void;
	onHeaderDragStart: ( e: React.DragEvent ) => void;
	onHeaderDragOver: ( e: React.DragEvent ) => void;
	onHeaderDrop: ( e: React.DragEvent ) => void;
	onDragEnd: () => void;
	children: React.ReactNode;
} ) {
	const collapsed = Boolean( project.collapsed );
	const headingId = `project-heading-${ project.id }`;

	return (
		<section
			aria-labelledby={ headingId }
			className={ cx(
				'mb-1.5 ms-1 rounded-md border py-1 transition-all',
				isMac() ? 'me-5' : 'me-4',
				isDragOver ? 'border-white/30 bg-[#ffffff14]' : 'border-white/10 bg-[#ffffff08]'
			) }
		>
			<div
				className={ cx(
					'flex flex-row items-center h-7 mx-1 rounded transition-all group',
					isDragOver ? 'bg-[#ffffff1a]' : 'hover:bg-[#ffffff0C]'
				) }
				onContextMenu={ onContextMenu }
				draggable={ ! isRenaming }
				onDragStart={ onHeaderDragStart }
				onDragOver={ onHeaderDragOver }
				onDrop={ onHeaderDrop }
				onDragEnd={ onDragEnd }
			>
				{ isRenaming ? (
					<ProjectNameField
						initialName={ project.name }
						onCommit={ onRename }
						onCancel={ onRenameCancel }
					/>
				) : (
					<button
						type="button"
						id={ headingId }
						aria-expanded={ ! collapsed }
						onClick={ onToggleCollapsed }
						onDoubleClick={ onContextMenu }
						className="flex flex-row items-center gap-1.5 flex-1 min-w-0 px-2 h-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme rounded"
					>
						<span className="text-a8c-gray-50">
							<Chevron collapsed={ collapsed } />
						</span>
						<span className="text-xs font-semibold uppercase tracking-wide text-a8c-gray-50 whitespace-nowrap overflow-hidden text-ellipsis">
							{ project.name }
						</span>
						{ collapsed && siteCount > 0 && (
							<span className="text-xs text-a8c-gray-50/70 shrink-0">{ siteCount }</span>
						) }
						{ /* A collapsed project must not hide the fact that something inside is running. */ }
						{ collapsed && hasRunningSite && (
							<span
								className="w-2 h-2 rounded-full bg-a8c-green-20 border-[0.5px] border-a8c-green-20 shrink-0"
								aria-label={ sprintf(
									/* translators: %s is the project name. */
									__( '%s has a running site' ),
									project.name
								) }
							/>
						) }
					</button>
				) }
			</div>

			{ ! collapsed && children }
		</section>
	);
}

/** The inline rename field. Enter or blur commits, Escape reverts, empty reverts. */
function ProjectNameField( {
	initialName,
	onCommit,
	onCancel,
}: {
	initialName: string;
	onCommit: ( name: string ) => void;
	onCancel: () => void;
} ) {
	const [ value, setValue ] = useState( initialName );
	const inputRef = useRef< HTMLInputElement >( null );
	// Escape must not also commit through the blur handler that follows it.
	const cancelledRef = useRef( false );

	useEffect( () => {
		inputRef.current?.select();
	}, [] );

	const commit = () => {
		if ( cancelledRef.current ) {
			return;
		}
		const trimmed = value.trim();
		if ( ! trimmed || trimmed === initialName ) {
			onCancel();
			return;
		}
		onCommit( trimmed );
	};

	return (
		<input
			ref={ inputRef }
			value={ value }
			aria-label={ __( 'Project name' ) }
			onChange={ ( e ) => setValue( e.target.value ) }
			onBlur={ commit }
			onKeyDown={ ( e ) => {
				if ( e.key === 'Enter' ) {
					e.preventDefault();
					commit();
				} else if ( e.key === 'Escape' ) {
					e.preventDefault();
					cancelledRef.current = true;
					onCancel();
				}
			} }
			className="flex-1 min-w-0 mx-2 px-1 h-5 bg-[#ffffff19] text-xs text-chrome-inverted rounded border border-white/20 focus:outline-none focus:ring-1 focus:ring-frame-theme"
		/>
	);
}
