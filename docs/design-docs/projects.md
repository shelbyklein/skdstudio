# Projects: grouping sites in the sidebar

## Goal

Let sites sit in named folders ("Projects") in the sidebar, so the dev, staging and production
copies of one site live together and apart from everything else. A project is created in the
sidebar, sites are dragged into it, and the whole thing survives restarts.

```
▾ SDHQ
    SDHQ Dev          ●
    SDHQ Staging      ○
    SDHQ Production   ○
▾ Sisol
    sisol             ○
▸ Client work (4)
  Bricks Starter      ●        ← ungrouped sites follow the projects
  Etch Starter        ○
```

Out of scope for the first version: nested projects, projects shared with the CLI, a project
carrying its own deploy target, and any WordPress-side change. Sites keep their own `deployTarget`
and `environmentType`; a project is purely a sidebar container.

## What exists today

The sidebar already reorders sites by drag and drop. `SiteMenu`
(`apps/studio/src/components/site-menu.tsx`) uses native HTML5 DnD (`draggable`, `onDragOver`,
`onDrop`) with `draggedIndex` / `dragOverIndex` state, and hands the new order to
`updateSitesSortOrder` in `apps/studio/src/hooks/use-site-details.tsx`, which debounces a write of
`{ siteId, sortOrder }` pairs to the `updateSitesSortOrder` IPC handler. Sort order is stored per
site in `app.json` under `siteMetadata[id].sortOrder` (`AppdataSiteData` in
`apps/studio/src/storage/storage-types.ts`), merged onto each `SiteDetails` in `getSiteDetails`
(`apps/studio/src/ipc-handlers.ts:179`), and listed in `STUDIO_ONLY_DETAIL_KEYS`
(`apps/studio/src/modules/cli/lib/cli-events-subscriber.ts`) so a CLI site event does not wipe it.

Projects follow exactly that shape: one more desktop-only field on each site, plus a list of
projects, all in `app.json`.

Two things in the existing code shape the design:

- **Do not call the new key `desks`.** Migration
  `apps/studio/src/migrations/07-remove-desks-config.ts` deletes a top-level `desks` key from
  `app.json` on every launch that finds one. It removed an upstream feature and still runs. The new
  key is `projects`.
- The site context menu is built in the **main process** with Electron `Menu`
  (`showSiteContextMenu`, `apps/studio/src/ipc-handlers.ts:1372`) and sends the chosen action back
  over the `site-context-menu-action` event. A "Move to project" submenu therefore needs the
  project list passed in from the renderer, and the reply needs to carry a `projectId`.

## Data model

All of it lives in `app.json`, next to the other per-site desktop metadata. The CLI has no use for
projects, and putting a desktop-only concept in `cli.json` is the thing migration 08 exists to
undo. No migration is needed: every new field is optional, and an `app.json` without `projects`
means "no projects, every site ungrouped".

```ts
// apps/studio/src/storage/storage-types.ts
export interface Project {
	id: string;        // crypto.randomUUID()
	name: string;
	sortOrder: number; // same (index + 1) * 1000 scheme as sites
	collapsed?: boolean;
}

export interface AppdataSiteData {
	// …existing fields…
	projectId?: string; // absent or dangling = ungrouped
}

export interface UserData {
	// …existing fields…
	projects?: Project[];
}
```

Rules:

- `sortOrder` on a site orders it **within its container** (its project, or the ungrouped list).
  Two sites in different projects can share a value. This keeps `updateSitesSortOrder` and every
  existing caller valid.
- A `projectId` that names no project is treated as ungrouped, never as an error. Deleting a
  project clears `projectId` on its sites; it never deletes a site. A site removed with
  `deleteSite` takes its `siteMetadata` entry with it, as today.
- `collapsed` is persisted here rather than in renderer state so the sidebar reopens the way it was
  left. It is per-machine, which is what a single-user desktop app wants.

`projectId` is exposed on `SiteDetails` the same way `sortOrder` is: added to `StoppedSiteDetails`
in `apps/studio/src/ipc-types.d.ts`, copied in `getSiteDetails`, and appended to
`STUDIO_ONLY_DETAIL_KEYS` so a `SITE_EVENTS.UPDATED` from a `skdstudio pull` does not ungroup the
site.

## IPC surface

New handlers live in a new module, `apps/studio/src/modules/projects/lib/ipc-handlers.ts`, and are
re-exported from `apps/studio/src/ipc-handlers.ts` the way the deploy module's are. Because
`IpcApi` is a mapped type over that file's exports, the preload bridge and renderer types follow
without hand edits, and a missed binding fails `npm run typecheck`. Every write takes
`lockAppdata()` / `unlockAppdata()`.

| Handler | Does |
| --- | --- |
| `getProjects()` | Returns `Project[]` sorted by `sortOrder`. |
| `createProject(name)` | Appends with the next `sortOrder`; returns the project. Trims the name and rejects an empty one. |
| `renameProject(id, name)` | |
| `deleteProject(id)` | Removes it and clears `projectId` on every site that pointed at it, in one locked write. |
| `setProjectCollapsed(id, collapsed)` | |
| `updateProjectsSortOrder(updates)` | `{ projectId, sortOrder }[]`, mirrors the site version. |
| `updateSitesSortOrder(updates)` | **Extended**: each entry gains `projectId: string \| null`. `null` means ungroup. One debounced write already handles a reorder; now the same write handles a move between containers. |
| `setSiteProject(siteId, projectId)` | Puts one site in a project, or takes it out with `null`. Used when a site is created into a project, where there is no ordering to express. |

`showSiteContextMenu` gains `projects: { id: string; name: string }[]` and `projectId` on its
context and appends a "Move to project ▸" submenu listing every project, a divider, "None", and
"New project…". The reply becomes
`{ action: 'move-to-project', siteId, projectId: string | null }` or
`{ action: 'new-project', siteId }`. A new `showProjectContextMenu(projectId)` offers Rename,
Collapse/Expand, and Delete project.

## Renderer

### Grouping

A pure helper `groupSites( sites, projects )` in `apps/studio/src/modules/projects/lib/group-sites.ts`
returns

```ts
{ projects: { project: Project; sites: SiteDetails[] }[]; ungrouped: SiteDetails[] }
```

with both lists ordered by `sortOrder`, dangling `projectId`s folded into `ungrouped`. It has no
React in it and is the thing the unit tests exercise hardest. The existing `sortSites` in
`use-site-details.tsx` keeps sorting the flat list; the sidebar groups on top of it.

A `useProjects()` hook (`apps/studio/src/modules/projects/hooks/use-projects.tsx`) holds the
project list, loads it once from `getProjects`, and wraps each mutation so it updates local state
first and writes second — the same optimistic pattern `updateSitesSortOrder` uses.

### Sidebar layout

`SiteMenu` renders, in order: one `ProjectSection` per project, then the ungrouped sites with no
header. Projects first because that is where the organised work is; ungrouped sites are the inbox.
New sites are ungrouped unless created from inside a project (see below), so they appear at the end
of the list where the eye already goes for "new thing".

`ProjectSection` is a header row (disclosure chevron, name, count when collapsed) followed by the
site rows it owns, reusing the existing `SiteItem` unchanged apart from a `projectId` prop. An empty
project shows a muted "Drop sites here" row so it stays a visible drop target. The header, the
chevron and the placeholder all use `--color-frame-*` tokens and must be checked in both colour
schemes.

The `RunningSites` strip and `AddSite` button below the list are untouched.

### Drag and drop

Extend the existing native DnD rather than adding a library. The drag payload becomes
`{ kind: 'site', siteId }` or `{ kind: 'project', projectId }` in `dataTransfer`, and the drop
targets become:

| Drop on | Result |
| --- | --- |
| a site row | Insert before it, in that row's container (moving containers if they differ). |
| a project header | Append to that project; expands it if collapsed. |
| the empty-project placeholder | Append to that project. |
| the bottom drop zone / ungrouped area | Append to ungrouped. |
| a project header, dragging a project | Reorder projects. |

Each drop computes the destination container's new order, assigns `(index + 1) * 1000`, and calls
`updateSitesSortOrder` with `projectId` set on every entry of the affected containers. Because the
write is one debounced call, a move is atomic from the store's point of view.

Drag-over highlighting on a header uses a full-row tint, on a site row the existing top-border
indicator. Dropping a site onto its own current position is a no-op, as today.

### Keyboard and screen readers

HTML5 DnD is mouse-only, so every DnD action has a non-drag path: "Move to project ▸" in the site
context menu, "Rename" / "Delete project" in the project context menu, and Enter/Space on a focused
header toggles collapse. Moves are announced with `speak()` from `@wordpress/a11y`, matching how
start/stop is announced in `ButtonToRun`. The nav keeps `aria-label="Sites"`; each `ProjectSection`
is a `<section aria-labelledby>` wrapping its own `<ul>`.

### Moving sites

`planSiteMove` (`apps/studio/src/modules/projects/lib/plan-move.ts`) turns a drop into the
`updateSitesSortOrder` payload it implies, and returns an empty list for a no-op. It renumbers only
the destination container: pulling a site out of a list leaves the rest in order. `planProjectMove`
is its equivalent for reordering the projects themselves. Both are pure, and carry the unit tests
for the awkward cases.

### Creating and naming projects

- "New project…" from a site's context menu creates the project and moves that site into it in one
  step, then opens inline rename on the header.
- Right-clicking empty sidebar space (or a small "+" that appears on hover beside the first header)
  offers "New project".
- Rename is an inline text field on the header (double-click, or context menu). Escape cancels,
  Enter/blur commits, empty reverts. Names need not be unique.
- Delete asks for confirmation only if the project is non-empty, and the dialog says the sites will
  be kept, not deleted.

### New sites

`CreateSiteForm` (`apps/studio/src/modules/add-site/components/create-site-form.tsx`) gets a
"Project" select, shown only when projects exist, defaulting to the selected site's project — so
creating "SDHQ Production" while "SDHQ Staging" is selected lands it in the same folder. The form
reads that default from `useSiteDetails()` itself rather than taking it as a prop through four
layers. `useAddSite` writes it with `setSiteProject` in the `onSiteCreated` callback. Selecting a site
whose project is collapsed expands the project, so a site reached from the Manage tab or a context
menu is never selected-but-hidden.

## Implementation status

Phases 1–4 are built; the Playwright case in phase 4 and the light/dark pass are the remainder.
Each phase leaves the app working and typechecking, so it can be committed and packaged on its own.

1. **Storage and IPC.** `Project` / `projectId` / `projects` types; the handlers in
   `modules/projects/lib/ipc-handlers.ts` and their re-exports; `projectId` in `getSiteDetails`,
   `ipc-types.d.ts`, and `STUDIO_ONLY_DETAIL_KEYS`; extend `updateSitesSortOrder`. Unit tests in
   `modules/projects/lib/tests/` for every handler (create, rename, delete-clears-sites,
   dangling id, lock held), and for `groupSites`.
2. **Grouped rendering, no drag.** `useProjects`, `groupSites`, `ProjectSection`, collapse,
   the ungrouped section, project context menu, "Move to project" submenu, "New project…",
   inline rename, delete confirmation. This alone delivers the feature for keyboard users. Extend
   `apps/studio/src/components/tests/main-sidebar.test.tsx` with grouped fixtures.
3. **Drag and drop.** Cross-container drops, header drops, project reordering, the empty
   placeholder. Tests dispatch `dragstart`/`dragover`/`drop` with `@testing-library` on the fixtures
   from phase 2 and assert the `updateSitesSortOrder` payload.
4. **Polish.** Project select on the create form, auto-expand on select, `speak()` announcements,
   light and dark check, one Playwright case in `apps/studio/e2e/` that creates a project, moves a
   site, restarts the app and finds it still grouped.
5. **Package** (`npm run package`) and verify the packaged app, per the standing rule.

Phases 1 and 2 are the bulk of the work; 3 is mostly rearranging what `SiteMenu` already does; 4 is
small.

## Decisions taken, and why

- **app.json, not cli.json.** Same reasoning as the `autoStart` relocation: only the desktop acts
  on it. `skdstudio list` stays flat. If a grouped CLI listing is ever wanted, the CLI can read
  `app.json` read-only rather than owning the data.
- **One level only.** Nested folders make DnD, keyboard navigation and the "Move to" submenu all
  materially harder, and the stated need (dev / staging / prod per site) is one level.
- **Ungrouped after projects, no header.** A "Ungrouped" header would be a fake project that
  cannot be renamed or deleted, and every new site would appear under it, which reads as a mistake.
- **Per-container `sortOrder` instead of a global order.** Keeps every existing caller and the
  `updateSitesSortOrder` contract, and makes "append to project" a local computation.
- **Native DnD kept.** A library would add a dependency for one list. The current code already
  handles the hard parts (indices, indicators, the bottom drop zone); the change is the payload and
  the drop targets.

## Open questions

Defaults are stated; none block phase 1.

- Should a site row show its `environmentType` (`WP_ENVIRONMENT_TYPE`: development / staging /
  production, already on `SiteDetails`) as a small tag? It is the natural companion to this feature
  but is independent of it. Default: not in this change.
- Should collapsing a project stop showing its running dots? **Built as stated**: a collapsed
  header shows the site count and a single green dot when any site inside is running.
- Should "Delete project" also offer "Delete project and its sites"? Default: no. Deleting sites is
  the site menu's job, and putting it behind a folder action is how someone loses three sites at
  once.
