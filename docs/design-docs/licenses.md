# Premium license keys in Blueprints

## About this doc

How Studio stores license keys for paid plugins and themes, how a Blueprint asks
for one without containing it, and why each part works the way it does.

## Context

A Blueprint that builds a real starter site — Bricks plus Automatic.css, say —
produces a site that is installed but unlicensed. Entering the same keys by hand
after every spin-up is the tedious part, and the obvious fix (put the keys in the
Blueprint) is the wrong one: Blueprints are files you hand to other people.

So the split is: a Blueprint declares *where* a key belongs, Studio holds *what*
the key is, and the two meet only on the machine creating the site.

## High level approach

A Blueprint marks a spot with a placeholder:

```json
{
  "constants": { "BRICKS_LICENSE_KEY": "${studio.license:bricks}" },
  "siteOptions": { "automatic_css_license_key": "${studio.license:acss}" }
}
```

`bricks` and `acss` are names in the user's vault, not keys. The Blueprint stays
safe to commit, share, or attach to a bug report.

Placeholders are allowed in `constants` and `siteOptions` only. That is not an
arbitrary restriction — the Playground Blueprint schema sets
`additionalProperties: false` at the top level and on `meta`, so a custom
`licenses` key would fail `validateBlueprintData()`. `constants` and
`siteOptions` both accept arbitrary strings, and between them they cover how
premium plugins actually read a key: a PHP constant or a WordPress option.

## Data flow

1. **Storage.** The user adds a key in Settings → Licenses. The main process
   encrypts it with Electron's `safeStorage` (Keychain / DPAPI / libsecret) and
   writes the ciphertext to `~/.skdstudio/licenses.json`, mode 600, under its own
   lockfile. Not `app.json`: that file is read and logged widely and should never
   carry secrets.
2. **Creation.** `createSite` calls `applyLicensesToBlueprint()` before handing
   the Blueprint to the CLI. It scans for placeholders, decrypts only the slugs
   the Blueprint asked for, and substitutes them.
3. **Application.** The resolved Blueprint goes to `studio site create` through
   the existing `--blueprint <tmpfile>` path. `constants` land in wp-config.php
   via `ensureWpConfig()`; `siteOptions` are applied by the Blueprint runner.

The renderer never sees a key. `getLicenses` returns slugs, labels and
timestamps — enough to render the list, nothing more.

## Why the desktop app resolves, and not the CLI

`safeStorage` is an Electron API. The CLI is a plain Node process and cannot
decrypt the vault, so resolution has to happen on the desktop side and the CLI
receives a Blueprint with the keys already in it.

The consequence is honest and worth stating: **`studio create --blueprint` run
from a terminal does not resolve placeholders.** Those sites are created
unlicensed, with the placeholder text left intact. Substituting a bogus value
would be worse — an unresolved placeholder in wp-config.php is visibly wrong,
where a fake key looks like a licensing bug.

The same rule covers a slug the vault has no key for: it is left in place and
reported in `missing`.

## Activation

Studio injects keys. It does not activate them. Each plugin talks to its own
store on its own schedule, which keeps site creation free of outbound network
calls and keeps Studio out of the business of replaying vendor licensing APIs.

Bricks reads `BRICKS_LICENSE_KEY` natively and validates by itself. Automatic.css
gets its key in the right option and activates when its settings page is opened.

**Freemius-based plugins cannot be preseeded at all.** Freemius has no license
constant and binds an activation to an install record keyed to the site URL, so
there is no supported place to put a key ahead of time. SchemaWP is in this
category; it is activated by hand, per site.

## Activation limits

Every license counts activations per site URL, and every new site is a new URL.
This feature makes it easy to burn through a license's activation slots quickly.
Deactivate a site's license before discarding the site.

## A worked example

`blueprints/bricks-stack.json` is a real Blueprint for the four vault entries that can be
preseeded: Bricks (`BRICKS_LICENSE_KEY`), ACF Pro (`ACF_PRO_LICENSE`), WS Form
(`WSF_LICENSE_KEY` — confirmed by reading `class-ws-form-licensing.php`, which builds this from
the `license_key` option name), and Novamira Pro (`nvp_license_key`, a site option rather than a
constant — confirmed by reading its `includes/licensing.php`). `schemawp` is in the vault too but
is Freemius-based and left out, per the limitation above.

Its `activate*` steps assume the theme and plugins are already present in `wp-content` — this
Blueprint licenses a stack, it does not install one, since these are premium zips with no
downloadable URL to declare. Run it against a site that already has them (e.g. a duplicate of an
existing Bricks site) rather than a bare WordPress install.

## Files

- `packages/common/lib/licenses.ts` — placeholder scanning and substitution. Pure
  and shared; unit-tested in `packages/common/lib/tests/licenses.test.ts`.
- `apps/studio/src/storage/license-vault.ts` — `safeStorage` encryption, the
  `licenses.json` file and its lock. Main process only.
- `apps/studio/src/modules/licenses/lib/` — IPC handlers and
  `applyLicensesToBlueprint()`.
- `apps/studio/src/modules/user-settings/components/licenses-tab.tsx` — the UI.

## Notes

- When the OS has no usable keyring (`safeStorage.isEncryptionAvailable()` is
  false, common on Linux without a keyring daemon), storing is **refused** rather
  than falling back to plaintext. The tab says so.
- A vault copied to another machine or user account will not decrypt. Those
  entries are treated as missing rather than as a hard failure.
- The temp Blueprint file written by `buildSiteCreateArgs` is mode 600, because
  after resolution it holds real keys.
- `license` is in `sensitiveKeys` in `src/lib/sanitize-for-logging.ts`.
