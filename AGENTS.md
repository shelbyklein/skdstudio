# AI Instructions

SKD Studio (repository `skdstudio`) — an Electron desktop app plus a CLI for running WordPress
sites locally and moving them to your own servers. A stripped-down fork of Automattic's WordPress Studio with every
WordPress.com-coupled feature removed. React + TypeScript renderer; sites run on a bundled native
PHP binary or in the WordPress Playground WASM sandbox.

## How much verification

This is a personal internal tool with one user, not a shipping product. He is the judge of whether
a change is right — so the job is to **put a working fix in front of him**, then let him say yes or
no. Do whatever that takes, including packaging. What to cut is the work that only builds a *case*
for a change he could just look at: exhaustive suites, repeat runs, proving something already
obvious.

Two failure modes, and the second is the one to watch:

- Doing too much — running the full suite and an e2e battery and a package for a CSS tweak.
- Doing too little — handing him a diff he cannot see the effect of, and making him decide whether
  it is worth verifying. Do not stop short and ask "shall I package this?" when packaging is what
  it takes for him to see the fix at all. Package it and show him.

**The default loop for any change**: write it, `npx eslint --fix` the files you touched,
`npm run typecheck`, then get it to where he can judge it — for renderer work that is usually
`npm start`, for anything he runs in the packaged app that means packaging. Report and stop.

**Add tests to that loop** only when you wrote or changed logic that tests already cover, and then
run **only that path** (`npm test -- src/modules/projects`). Writing new tests is worth it for
tricky pure logic — URL rewriting, sort and grouping maths, anything with off-by-one risk. It is
not worth it for wiring, styling, or a prop being passed through.

**Spend these only when they change what you can hand him**:

- `npm test` with no filter — 1500+ tests, ~30s, and some CLI suites are flaky on ports. Run the
  path you touched instead.
- `npm run e2e` (Playwright) — minutes per test. **It launches the packaged app from
  `apps/studio/out`, not your source**, so it tests the last build; package first or it measures
  nothing. Worth it for a behaviour you cannot otherwise demonstrate, such as drag and drop.
- `npm run package` — the expensive one, but the only way he sees a change in the app he runs.

Tell him plainly what you skipped. "Typechecks and the projects tests pass; I did not run the full
suite" is a complete and honest report.

## Essential Commands

**Dev/Build**: `npm start` | `npm run cli:build` | `node apps/cli/dist/cli/main.mjs`
**Test**: `npm test [-- path/to/test.test.ts]` | `npm run e2e` (Playwright, needs `npm run make`) | `npm run test:cli-e2e` (real-CLI suite, needs `npm run cli:build`, runs serially)
**Quality**: `npx eslint --fix <files>` (lint and format ONLY modified files)
**Package**: `npm run package:quick` (fast local build) | `npm run package` (clean-room) | `npm run make` (installers)

**IMPORTANT - Hot Reload**: Renderer auto-reloads, Main process needs restart (or `rs` in terminal). Changes to Main process IPC handlers require full restart.

### Packaging costs about ten minutes — do not do it reflexively

`npm run package` runs `scripts/package-in-isolation.ts`, which copies the repo to a temp directory,
runs `npm ci` there, builds, and copies a 146 MB result back. Including the forge `prePackage` hook
that is **three npm installs and three network downloads per run** (the PHP package is deleted and
re-fetched unconditionally). It is not a build; it is a clean-room release.

**Package when** the change is one he needs to see or use in the app — any renderer, main-process or
`apps/cli` change he will actually exercise there — or before running Playwright. Don't package for
work that never reaches the app he runs: docs, tests, build scripts, CLI-only fixes he will drive
from the terminal.

**`npm start` hot-reloads the renderer**, so while iterating on styling or React work, use that
rather than packaging between every attempt. Package once at the end, when the change is settled and
he needs it in his own build.

**When you do package locally**, use `npm run package:quick`. It sets `CI=true`, the script's own
short-circuit, which builds in place and skips the repo copy, the `npm ci` and the copy-back; and
`SKIP_LANGUAGE_PACKS=1`, honoured by `forge.config.ts`. The catch is that packaging in place mutates
`apps/studio/node_modules` and `apps/cli/node_modules`, so run `npm install` at the root before
returning to dev or tests. Use plain `npm run package` for a release-shaped build.

**A packaged app carries its own copy of the CLI.** `getCliPath` resolves to
`apps/cli/dist/cli/main.mjs` under `npm start`, but to `Contents/Resources/cli/main.mjs` inside a
packaged build. `npm run cli:build` therefore fixes the dev app and the `skdstudio` command while
leaving an already-packaged app running the old code. This is the one case where verifying with the
CLI alone proves nothing — it is why the rule above singles out `apps/cli` changes.

## CLI Commands

**MUST** build CLI before testing: `npm run cli:build && node apps/cli/dist/cli/main.mjs <command>`

Site verbs live at the top level (`create`, `list`, `start`, `stop`, `delete`, `status`) and are
implemented in `apps/cli/commands/site/`. `import`/`export` are in `apps/cli/commands/`, per-site
settings under `apps/cli/commands/config/`, and `wp` proxies WP-CLI. `server` (with `set`, `show`
and `forget`) records where a site is linked, `push` sends it there over SSH and `pull` brings the
live site back down; `deploy` remains as a hidden alias for both. The `site` group is kept
hidden for backward compatibility. `_events` is a hidden command the desktop app spawns to receive
site events from other CLI processes.

## Architecture

**Electron 3-Process**: Main (Node.js) → Preload (IPC bridge) → Renderer (React)
**Main Process** (`apps/studio/src/`): IPC handlers, storage, migrations, menus, window management
**Renderer** (`apps/studio/src/components`, `apps/studio/src/hooks`): React UI, Redux stores, TailwindCSS
**CLI** (`apps/cli/`): WordPress Playground (PHP WASM), native PHP process management, yargs commands. The desktop app forks it as a child process — it is the single execution engine for site operations.

## Directory Structure

**`/apps/studio/src`**: Main (index.ts, ipc-handlers.ts, storage/, lib/, migrations/) | Renderer (components/, hooks/, stores/) | modules/ (cli, deploy, import-export, user-settings, add-site, site-settings)
**`/apps/cli`**: index.ts, commands/ (site, config, import, export, deploy, wp), lib/ (cli-config, native-php, import-export, deploy, dependency-management, proxy-server, certificate-manager)
**`/packages/common`**: Shared lib/ (fs-utils, port-finder, shared-config, cli-process, deploy-ignore, deploy-target, sql-url-rewrite), types/, translations/
**`/tools/eslint-plugin-studio`**: eslint-plugin-studio

## Key Patterns

**IPC**: Renderer → `window.ipcApi.*` → Preload (contextBridge) → Main `ipc-handlers.ts` → Business logic. `IpcApi` is a mapped type derived from every export of `ipc-handlers.ts` (see `apps/studio/src/ipc-types.d.ts`), so a missing preload binding or a signature change fails `npm run typecheck`.
**Executing CLI work**: `executeCliCommand` (`apps/studio/src/modules/cli/lib/execute-command.ts`) forks `apps/cli/dist/cli/main.mjs`; progress flows back over `process.send` and is re-emitted to the renderer as Electron IPC events.
**Redux Stores**: RTK Query APIs: installedAppsApi, wordpressVersionsApi
**No network except WordPress.org**: the renderer CSP in `apps/studio/index.html` allows `api.wordpress.org` and a local websocket only. Do not add third-party endpoints, telemetry, or crash reporting.

## Tech Stack

**Frontend**: React 18, Redux Toolkit + RTK Query, @wordpress/components, TailwindCSS, TypeScript, Vite
**Main**: Electron
**CLI**: @wp-playground/cli, @php-wasm/node, @wp-playground/blueprints
**Dev**: electron-vite, electron-forge, Vitest, Playwright
**Other**: zod, yargs

## Build & Distribution

**Build**: CLI (`vite build --config apps/cli/vite.config.dev.ts`) → Electron (`electron-vite build --config apps/studio/electron.vite.config.ts`) → Package (`electron-forge make --config apps/studio/forge.config.ts`)
**Platforms**: macOS (x64/ARM64 DMG), Windows (x64/ARM64), Linux (DEB)
**Bundling**: Rolldown (main), Vite (renderer with code splitting), ASAR (resources)

## Conventions

**Files**: React components (PascalCase), utils (camelCase), tests (.test.ts/.tsx)
**Class names (`cx`)**: Use `cx()` (`apps/studio/src/lib/cx.ts`) only to join classes with conditions (e.g. `cx( 'base', isActive && 'active' )`). For a single static string, pass the bare string instead of wrapping it — `className="h-full"`, not `className={ cx( 'h-full' ) }`. Enforced (and auto-fixed) by the `studio/no-redundant-cx` ESLint rule (`tools/eslint-plugin-studio`).
**Theming / colors (renderer CSS)**: The content area supports light + dark via `@media (prefers-color-scheme: dark)`; the sidebar is always dark chrome and uses the `a8c-*` palette and translucent whites instead — match whichever surface you are editing. For any **color** (text, background, border, fill, brand/theme, error/running states) **MUST** use the dark-aware `--color-frame-*` tokens defined in `apps/studio/src/index.css` (e.g. `--color-frame-text`, `--color-frame-bg`, `--color-frame-surface`, `--color-frame-border`, `--color-frame-theme`, `--color-frame-error`). **NEVER** use `--wpds-color-*` tokens for color here — no color `ThemeProvider` wraps this app, so they fall back to light-only values and render broken (invisible text, wrong borders) in dark mode. When a needed color has no `--color-frame-*` token, add one (with both light and dark values). Non-color `--wpds-*` tokens (`--wpds-dimension-*`, `--wpds-typography-*`, `--wpds-border-width-*`, `--wpds-elevation-*`, `--wpds-cursor-*`) are theme-independent and fine to use.
**IPC Handlers** (`apps/studio/src/ipc-handlers.ts`): **MUST** `export async function handlerName(event, ...args): Promise<ReturnType>` | Void (send-style) handlers are listed in `IPC_VOID_HANDLERS` in `apps/studio/src/constants.ts` | All handlers MUST be async and return Promises
**Storage**: **CRITICAL** - Always use file locking when writing config. Each config file has its own lockfile and helpers: `lockAppdata()` / `unlockAppdata()` for `app.json` (`apps/studio/src/storage/user-data.ts`), `lockCliConfig()` / `unlockCliConfig()` for `cli.json` (`apps/cli/lib/cli-config/core.ts`), and `lockSharedConfig()` / `unlockSharedConfig()` for `shared.json` (`packages/common/lib/shared-config.ts`).
**i18n**: `@wordpress/i18n` (`__()` function), `packages/common/translations/`, `<I18nProvider>` (renderer), `loadTranslations()` (CLI)
**i18n - Never translate at module level**: **CRITICAL** - Do NOT call translation functions (`__()`, `_x()`, `_n()`, `_nx()`) in module-level constants, object literals, or arrays. They run when the module is first imported — before the locale data loads — so the string is captured once and never updates. This matters for the renderer, which is long-lived and swaps locale data live when the user switches language. Always wrap them in a function so they are re-evaluated at render/call time: use `const getLabel = () => __( 'Label' )` instead of `const LABEL = __( 'Label' )`. `apps/cli` is excluded: it is a one-shot process that loads the locale before importing modules. Enforced by the `studio/no-module-level-translations` ESLint rule (`tools/eslint-plugin-studio`).

## Paths

**App Data:** All platforms use `~/.studio/` (user's home directory). Resolve paths via the helpers in `packages/common/lib/well-known-paths.ts` (`getConfigDirectory`, `getSharedConfigPath`, `getAppConfigPath`, `getCliConfigPath`) rather than hardcoding.
- `~/.studio/shared.json` — state shared between Desktop and CLI (e.g. locale)
- `~/.studio/cli.json` — sites (CLI-owned)
- `~/.studio/app.json` — Desktop-only state (UI prefs, per-site metadata)
- Deprecated: pre-split builds used a single `appdata-v1.json` under the Electron platform path (macOS: `~/Library/Application Support/Studio/`, Windows: `%APPDATA%\Studio\`). On first launch the migration at `apps/studio/src/migrations/02-migrate-to-split-config.ts` splits it into the three files above and renames the original to `appdata-v1.deprecated.json`.

**Logs:**
- macOS: `~/Library/Logs/Studio/`
- Windows: `%APPDATA%\Studio\logs\`

**Sites:**
- All platforms: `~/Studio/` (user's home directory)

## Git Conventions

**Branches**: Create from `main` using dash-separated lowercase names. Include a verb for clarity. Examples: `add-ssh-deploy`, `fix-export-paths`.
**Commits**: Single-line messages. Clear and descriptive. Focus on "what" and "why", not "how".
**Code comments**: Before committing, remove verbose comments that narrate what the change does or why it was made (e.g. `// Added this to fix X`, restating the code in prose). Only keep comments a future reader genuinely needs — non-obvious rationale, gotchas, links to context — and match the comment density and style of the surrounding code.

## Pushes and pulls

`studio push` sends a site to the user's own server over SSH; `studio pull` is the inverse. Both
are surfaced in the desktop app's **Manage** tab. It shells out to the system `ssh`
and `rsync` on purpose — that reuses their `~/.ssh/config`, agent and jump hosts, and keeps keys
out of Studio. Do not replace this with an SSH library.

**Never copy `wp-config.php`, the SQLite integration, or the Studio mu-plugin loader to a server**
(`DEPLOY_ALWAYS_EXCLUDED` in `apps/cli/lib/deploy/excludes.ts`): the first carries the server's own
credentials, the second makes a MySQL host load the SQLite drop-in and fail, the third points at a
temp directory on the developer's machine. That list mirrors what `DefaultExporter` skips — keep
them in step.

**Serialized data**: any change to URL rewriting must keep PHP serialized string lengths correct
(`packages/common/lib/sql-url-rewrite.ts`). Getting this wrong destroys widget and plugin settings
silently, which is exactly the failure the rewriter exists to prevent. It has thorough unit tests;
extend them rather than working around them.

**Remote scripts** go to `bash -s` over stdin, never as ssh arguments, and database credentials go
in a mode-600 my.cnf, never on a command line.

**Pulls** stop the site first, because its files and database are replaced underneath it, and
afterwards repoint `studio_admin_username` at an administrator from the incoming database —
without that, one-click WP Admin breaks on every pulled site. See `docs/design-docs/deploy.md`.

## Projects (sidebar folders)

Sites can sit in named folders shown in the sidebar. A project is desktop-only state in `app.json`
(`projects[]`, plus `siteMetadata[id].projectId`) — the CLI has no concept of one, so do not move it
into `cli.json`. **Do not name the stored key `desks`**: the migration at
`apps/studio/src/migrations/07-remove-desks-config.ts` deletes a top-level `desks` key on every
launch that finds one.

`sortOrder` orders a site **within its container**, so two sites in different projects may share a
value. A `projectId` naming no project is treated as ungrouped, never as an error, and deleting a
project ungroups its sites rather than deleting them. Drag and drop is native HTML5 DnD; every move
also has a context-menu equivalent, because HTML5 DnD is pointer-only. See
`docs/design-docs/projects.md`.

## Fork Notes

This fork deliberately has no WordPress.com account, sync, preview sites, AI agent, analytics,
crash reporting, or auto-updater. If a task seems to need one of those, it is out of scope —
raise it rather than reintroducing the dependency. Upstream code that referenced them has been
removed, not stubbed, so there is nothing to re-enable.
