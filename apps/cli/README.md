# Skd studio CLI

The `studio` command creates, runs and deploys local WordPress sites. It is the
execution engine behind the Skd studio desktop app, which forks it for every
site operation, so the two always agree.

This package is not published to npm. Build it from the repository root:

```bash
npm run cli:build && node apps/cli/dist/cli/main.mjs --help
```

The desktop app installs the same binary as `studio` on your `PATH` from its
settings.

## Requirements

Node.js 24 or higher is recommended, for its newer V8 WebAssembly APIs. Node.js
22 is the minimum.

## Commands

Site verbs are available at the top level, so you can run them from inside a
site directory without a `--path`:

```bash
studio create
studio list
studio start
studio stop
studio status
studio delete
```

Per-site settings, including the PHP and WordPress version, the runtime, a
custom domain and Xdebug:

```bash
studio config get
studio config set --php 8.3 --domain mysite.local --https
```

Backups in and out:

```bash
studio import backup.tar.gz
studio export --mode full site.zip
```

WP-CLI against the site at `--path`:

```bash
studio wp plugin list
```

Deploying to a server you reach over SSH:

```bash
studio deploy set --host deploy@example.com --remote-path /var/www/mysite --remote-url https://example.com
studio deploy
```

See [the deploy design doc](../../docs/design-docs/deploy.md) for how a push
works, and `--help` on any command for its full options.

## Notes

`site` is kept as a hidden alias for the top-level verbs, so older scripts
calling `studio site list` still work. Site settings that used to live under
`studio site set` are now under `studio config set`.
