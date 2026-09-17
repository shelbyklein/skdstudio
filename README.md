# SKD Studio

A stripped-down fork of [WordPress Studio](https://github.com/Automattic/studio) that does two
things: **run WordPress sites on your machine**, and **push those sites to your own servers**
over SSH. The repository is `skdstudio`; the app calls itself SKD Studio.

Everything tied to WordPress.com has been removed — no account, no login, no telemetry, no cloud
preview sites, no AI assistant. The app talks to the local filesystem, to `api.wordpress.org` for
WordPress and translation downloads, and to nothing else.

## What it does

- **Create local sites** from scratch or from a [Blueprint](https://developer.wordpress.org/playground/developers/blueprints/) file.
- **Run them natively** with a bundled PHP binary, or in the WordPress Playground WASM sandbox.
- **Pick a PHP version and a WordPress version** per site, with Xdebug available on the native runtime.
- **Serve sites over a custom domain with HTTPS**, backed by a locally trusted certificate.
- **Import** a site from a Studio/Jetpack backup, a Local or Playground export, a `.wpress` archive, or a bare SQL or WXR dump.
- **Export** a site as a full backup, a content-only archive, or a database dump, optionally applying a per-site `.deployignore`.
- **Run WP-CLI** against any site, from the app or from the `studio` CLI.
- **Deploy to your own server** over SSH: files and database, with URLs rewritten to match.
- **Pull the live site back down** the same way, to work on what is actually running.

## What was removed

WordPress.com and Pressable sync, cloud-hosted preview sites, the Studio Code AI agent and its
browser UI, OAuth sign-in, Tracks analytics and Sentry crash reporting, the auto-updater, the
onboarding and "What's New" flows, the WordPress.com blueprint gallery, the static-site importer,
and the Automattic release tooling (Buildkite, Fastlane, AppX signing, GlotPress sync).

## Pushing to your server, and pulling back down

Point a site at a server you can already reach over SSH, then push to it. Studio
uses the system `ssh` and `rsync`, so your existing keys, `~/.ssh/config` aliases,
jump hosts and ports all work unchanged, and no key or passphrase passes through
Studio.

From the app, open a site's **Manage** tab, which has a Push and a Pull section. From the terminal:

```bash
studio server set --host deploy@example.com --remote-path /home/deploy/webapps/mysite --remote-url https://example.com
```

Then move the site in either direction:

```bash
studio push
```

```bash
studio pull
```

A push replaces both the files and the database on the server, and rewrites
local URLs to the site address. A pull does the same in reverse, replacing the
local site with what is running on the server. Serialized PHP in the database is rewritten
correctly, so widget and theme settings survive the move. Your server's
`wp-config.php` is never overwritten, and the SQLite integration Studio runs on
locally is never copied up. Use `--dry-run` to see what would change, and a
`.deployignore` file in the site directory to keep files out of the push.

The server needs `rsync`, plus either WP-CLI or PHP and the `mysql` client.
Studio detects which and adapts. It keeps a copy of the live database on the
server before replacing it, under `.studio-deploy/`.

Both directions rewrite URLs and keep each side's own `wp-config.php`, so the
server keeps its MySQL credentials and your local site keeps its SQLite setup.
A pull also points one-click WP Admin at an administrator that exists in the
database it just brought down.

> [!WARNING]
> Each direction overwrites the other side. A deploy loses anything added on the
> server since the last push, such as new orders or comments; a pull loses local
> changes you have not deployed. Pass `--skip-database` to move files only, or
> `--dry-run` to see what would change.

See [the deploy design doc](docs/design-docs/deploy.md) for how it works.

## Requirements

- [Node.js](https://nodejs.org/) — the version in [`.nvmrc`](.nvmrc).
- Python and [setuptools](https://pypi.org/project/setuptools/), for building native dependencies.

On macOS with Homebrew:

```bash
brew install python3 python-setuptools
```

## Run it

```bash
nvm use && npm install && npm start
```

`npm install` also downloads the PHP binary, the WordPress server files, and the available site
translations, so the first install takes a few minutes. Packaging additionally fetches the
WordPress language packs, so sites created in another language are installed in it.

To build installers for your platform:

```bash
npm run make
```

Output lands in `apps/studio/out/`. See the [Linux notes](docs/linux.md) for platform specifics.

## The CLI

The same site engine is available as a command line tool. Build it, then run it directly:

```bash
npm run cli:build && node apps/cli/dist/cli/main.mjs --help
```

| Command | What it does |
| --- | --- |
| `studio create` | Create a site in the current directory or at `--path`. |
| `studio list` | List known sites and whether they are running. |
| `studio start` / `stop` / `status` | Control a site's server. |
| `studio delete` | Remove a site and its files. |
| `studio import` / `export` | Move a site in or out of a backup archive. |
| `studio config get` / `set` | Read or change a site's PHP and WordPress version, runtime, domain, HTTPS, Xdebug and debug flags. |
| `studio server` | Set, show or forget the server a site is linked to. |
| `studio push` | Send the site up to that server. |
| `studio pull` | Bring the live site back down from it. |
| `studio wp <args>` | Run WP-CLI against the site at `--path`. |

The desktop app installs this as `studio` on your `PATH` from its settings.

## Where things live

| Path | Contents |
| --- | --- |
| `apps/studio/` | The Electron app: main process, preload bridge, React renderer. |
| `apps/cli/` | The `studio` CLI, which is also the engine the desktop app forks. |
| `packages/common/` | Electron-free code shared by both. |
| `tools/eslint-plugin-studio/` | Repository-specific lint rules. |

State lives in `~/.studio/` (`shared.json`, `cli.json`, `app.json`) and sites default to `~/Studio/`.

## Documentation

- [Code contributions](docs/code-contributions.md) — development, testing, debugging, packaging.
- [Pushing and pulling your sites](docs/design-docs/deploy.md)
- [CLI design](docs/design-docs/cli.md)
- [Custom domains and SSL](docs/design-docs/custom-domains-and-ssl.md)
- [Native PHP binaries](docs/design-docs/native-php-binaries.md)
- [Testing with local Playground packages](docs/testing-with-local-playground.md)

## License

GPLv2, inherited from [WordPress Studio](https://github.com/Automattic/studio). See [LICENSE.md](LICENSE.md).
