# Code Contributions

## Development

### Required Dependencies

Before you can build and run the app, you need to install the following dependencies:

- [Node.js](https://nodejs.org/) - required JavaScript runtime environment.
- [Python](https://www.python.org/) - required for building native dependencies.
- [setuptools](https://pypi.org/project/setuptools/) - required for building native dependencies.

If you manage packages with Homebrew you can do the following:

```bash
brew install python3 python-setuptools
```

`nvm` commands referenced in the remaining documentation operate under the assumption that installed Node.js versions are managed with [`nvm`](https://github.com/nvm-sh/nvm). To use the correct Node.js version and install the project dependencies, run the following commands:

```bash
nvm use
npm install
```

This is an npm workspaces monorepo. Run installs from the repo root; the root `postinstall` also downloads the PHP binary, the WordPress server files, and the available site translations.

### Running the App

Once all required dependencies are installed, you can run the app with the following command:

```bash
npm start
```

This command starts the app in dev mode and opens it automatically, with the Chromium developer tools opened by default. Packaging uses [Electron Forge](https://www.electronforge.io/); dev and build use [electron-vite](https://electron-vite.org/).

To start with a clean, isolated appdata directory (useful for testing without affecting your real sites), use `npm run start:test` instead. It points `DEV_CONFIG_DIR` at `/tmp/studio-test`.

As with any Electron app, the code is split into two processes:

1. **Renderer Process** (reloads automatically):

   - All React components and UI code in `apps/studio/src/components/`, `apps/studio/src/modules/*/components/`
   - Hooks, stores, and utilities used by the UI (`apps/studio/src/hooks/`, `apps/studio/src/stores/`, etc.)
   - Any code that runs in the browser window context

2. **Main Process** (requires restart):
   - IPC handlers in `apps/studio/src/ipc-handlers.ts`
   - Electron main process code in `apps/studio/src/index.ts`
   - Node.js operations like file system access
   - Forking the CLI to perform site operations

When editing main process code, you can either:

- Restart the app manually, or
- Type `rs` in the terminal where you ran `npm start` to restart the server

A good rule of thumb: if the code interacts with the operating system, file system, or PHP server, it's likely main process code and will need a restart to see changes.

> [!TIP]
> If you encounter `Error: Cannot find module 'appdmg'` error, ensure that `python-setuptools` are installed in your environment according to the previous steps.

### Running the CLI

The CLI is built separately from the Electron app. There are two commands to be aware of:

- `npm run cli:build` runs a one-time build.
- `npm run cli:watch` watches the source files and rebuilds automatically.

Both commands output a `apps/cli/dist/cli/main.mjs` file. To test the newly built CLI code, run the following command:

```bash
node apps/cli/dist/cli/main.mjs --help
```

The desktop app forks this same file for every site operation, so a stale CLI build will make the app behave like the code you just changed does not exist.

### Project Structure

The project follows a modular architecture with both global and feature-specific code organization:

#### Global Directories

| Directory                     | Description                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `apps/cli/`                   | Root directory for CLI code                                                   |
| `apps/studio/src/`            | Root directory for desktop app code                                           |
| `apps/studio/src/components/` | Reusable UI components used across the application                            |
| `apps/studio/src/hooks/`      | Global React hooks                                                            |
| `apps/studio/src/lib/`        | Utility functions and helper libraries                                        |
| `apps/studio/src/modules/`    | Feature-specific code                                                         |
| `apps/studio/src/stores/`     | Global state management (Redux stores)                                        |
| `packages/common/`            | Shared code between CLI and desktop app (constants, types, utility functions) |
| `tools/eslint-plugin-studio/` | Custom ESLint rules                                                           |

#### Important Entry Points

| File                          | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `apps/cli/index.ts`           | The entry point for the CLI bundle                                          |
| `apps/studio/src/index.ts`    | The entry point for the main process                                        |
| `apps/studio/src/renderer.ts` | The entry point for the "renderer," the code running in the Chromium window |
| `apps/studio/src/preload.ts`  | The contextBridge that exposes `window.ipcApi` to the renderer              |
| `scripts/`                    | Scripts for building and testing the app                                    |

#### Feature Modules

Feature-specific code is organized in the `apps/studio/src/modules/` directory. Each module follows a consistent internal structure:

```
apps/studio/src/modules/
  ├── add-site/             # Site creation flow
  │   ├── components/       # Feature-specific components
  │   ├── hooks/            # Feature-specific hooks
  │   └── lib/              # Feature-specific utilities
  │
  ├── cli/                  # Installing and invoking the studio CLI
  ├── deploy/               # Pushing a site to a server over SSH
  ├── import-export/        # Backup import and export
  ├── site-settings/        # Per-site settings
  └── user-settings/        # Application preferences
```

Each feature module should be self-contained and include its own components, hooks, and utilities. This organization helps maintain separation of concerns and makes the codebase more maintainable.

### Code Formatting

Formatting is handled by Prettier through ESLint. Run `npx eslint --fix <files>` on the files you changed, or `npm run format` to format everything.

## Testing

### Unit Tests

Automated unit tests can be run with the following command:

```bash
npm run test
```

Or to run tests in "watch" mode:

```bash
npm run test:watch
```

Vitest is configured with one project per workspace (`cli`, `studio`, `common`, `eslint-plugin-studio`), so `npx vitest run --project studio` narrows a run to the desktop app.

### Real-CLI Tests

A separate suite spawns the built CLI and creates real WordPress sites on disk. It is tagged `e2e` and excluded from `npm run test`, because each case takes minutes and the cases cannot share ports:

```bash
npm run cli:build && npm run test:cli-e2e
```

That script runs the tagged cases one file at a time. Running them in parallel makes several sites race for the same port and fail with `EADDRINUSE`. They skip themselves entirely when `apps/cli/dist/cli/main.mjs` is missing.

### End-to-End Tests

Automated end-to-end (E2E) tests are also available. To run them, clean the `out/` directory and build the fresh app binary:

```bash
npm run make
```

Then run tests:

```bash
npm run e2e
```

Some e2e tests consume fixtures listed in `test-fixtures/manifest.json`. `npm run e2e` downloads them automatically; `npm run e2e:fixtures` does it on its own.

## Debugging

The renderer process can be debugged using the Chromium developer tools. To open the developer tools, press <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> on Mac or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> on Windows. You can also use the [React Developer Tools](https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi) and [Redux DevTools](https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd) to debug the renderer process.

The main process can be debugged using the Node.js inspector. To do this, run the app with the `--inspect-brk` and `--sourcemap` flags:

```bash
npm start -- --inspect-brk --sourcemap
```

Then open `chrome://inspect` in a Chromium-based browser and click "inspect" next to the process you want to debug.

## Building Installers

Once all required dependencies are installed, you can build installers for the app.
Installers can be built on Mac (Intel or Apple Silicon), Windows (x64 or ARM64), and Linux (x64 or ARM64) using the following commands:

```bash
npm install
npm run make
```

After the build process completes, you can find the executables in the `apps/studio/out/` directory. Builds are unsigned: this fork has no code-signing or notarization step, so macOS and Windows will warn on first launch.

Linux has additional source-build steps and platform-specific troubleshooting — see the [Linux notes](./linux.md).

## Localization

Studio's own interface strings ship as `studio-<locale>.jed.json` files in `packages/common/translations/`, registered in `packages/common/translations/index.ts`, with display names in `packages/common/lib/locale.ts`. There is no automated string-extraction or translation-sync pipeline in this fork; edit the files directly.

WordPress's own translations are separate. `npm run download-language-packs` fetches the core, bundled-plugin and bundled-theme language packs into `wp-files/latest/languages/`, and a new site created while Studio is set to another language is installed in it. Packaging runs this automatically; set `SKIP_LANGUAGE_PACKS=1` to skip it for a faster local build.

## Design Docs

- [Studio CLI](./design-docs/cli.md)
- [Deploying to your own server](./design-docs/deploy.md)
- [Custom Domains and SSL](./design-docs/custom-domains-and-ssl.md)
- [Native PHP Binaries](./design-docs/native-php-binaries.md)
