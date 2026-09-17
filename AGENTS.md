# AI Instructions

SKD Studio (repository `skdstudio`) — an Electron desktop app plus a CLI for running WordPress
sites locally and moving them to your own servers. A stripped-down fork of Automattic's WordPress Studio with every
WordPress.com-coupled feature removed. React + TypeScript renderer; sites run on a bundled native
PHP binary or in the WordPress Playground WASM sandbox.

## Essential Commands

**Dev/Build**: `npm start` | `npm run cli:build` | `node apps/cli/dist/cli/main.mjs`
**Test**: `npm test [-- path/to/test.test.ts]` | `npm run e2e` (Playwright, needs `npm run make`) | `npm run test:cli-e2e` (real-CLI suite, needs `npm run cli:build`, runs serially)
**Quality**: `npx eslint --fix <files>` (lint and format ONLY modified files)
**IMPORTANT - Post-Change Verification**: After applying code changes, always run the linter and format modified files (`npx eslint --fix <files>`), the type checker (`npm run typecheck`) and run relevant tests (`npm test [-- path/to/test]`) before considering the work complete. For any UI/CSS change, also verify the result in **both light and dark** color schemes.
**Package**: `npm run make` (builds installers for current platform)

**IMPORTANT - Hot Reload**: Renderer auto-reloads, Main process needs restart (or `rs` in terminal). Changes to Main process IPC handlers require full restart.

**IMPORTANT - A packaged app carries its own copy of the CLI.** `getCliPath` resolves to
`apps/cli/dist/cli/main.mjs` under `npm start`, but to `Contents/Resources/cli/main.mjs` inside a
packaged build. So `npm run cli:build` fixes the dev app and the `studio` command while leaving an
already-packaged app running the old code. After changing anything under `apps/cli`, re-run
`npm run package` before testing through a packaged app, and before concluding a CLI fix works
there. Verifying with the CLI alone proves nothing about what a packaged app will do.

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
**Theming / colors (renderer CSS)**: The renderer supports light + dark via `@media (prefers-color-scheme: dark)`. For any **color** (text, background, border, fill, brand/theme, error/running states) **MUST** use the dark-aware `--color-frame-*` tokens defined in `apps/studio/src/index.css` (e.g. `--color-frame-text`, `--color-frame-bg`, `--color-frame-surface`, `--color-frame-border`, `--color-frame-theme`, `--color-frame-error`). **NEVER** use `--wpds-color-*` tokens for color here — no color `ThemeProvider` wraps this app, so they fall back to light-only values and render broken (invisible text, wrong borders) in dark mode. When a needed color has no `--color-frame-*` token, add one (with both light and dark values). Non-color `--wpds-*` tokens (`--wpds-dimension-*`, `--wpds-typography-*`, `--wpds-border-width-*`, `--wpds-elevation-*`, `--wpds-cursor-*`) are theme-independent and fine to use.
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

## Fork Notes

This fork deliberately has no WordPress.com account, sync, preview sites, AI agent, analytics,
crash reporting, or auto-updater. If a task seems to need one of those, it is out of scope —
raise it rather than reintroducing the dependency. Upstream code that referenced them has been
removed, not stubbed, so there is nothing to re-enable.
