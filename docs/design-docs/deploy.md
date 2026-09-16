# Deploying to your own server

## About this doc

How `studio deploy` moves a local site onto a server you reach over SSH, and why
each step works the way it does.

## Context

The fork exists to run WordPress locally and then push it somewhere real. The
destinations are ordinary Linux boxes: a RunCloud-managed VPS, a DigitalOcean
droplet, a mini PC on the LAN. They have a WordPress install, a MySQL database,
and SSH access. They do not have a control-panel API worth targeting, and they
differ in what tooling is installed.

So a deploy is: copy the files, replace the database, and make the URLs match.

## High level approach

Studio shells out to the system `ssh` and `rsync` instead of using an SSH
library. That reuses the user's `~/.ssh/config`, agent, jump hosts and hardware
keys, so a server that already works in their terminal works here with no extra
setup, and Studio never handles a private key or a passphrase.

A deploy target is stored on the site record in `cli.json` under `deployTarget`.
One target per site. A second destination is a one-off push with flags rather
than a registry of named environments.

All of the work lives in the CLI, as with every other site operation; the
desktop app's Deploy tab forks `studio deploy` and renders the progress it
reports.

## Data flow

1. **Preflight.** One SSH round trip runs a bash script that reports whether the
   remote path exists and is writable, whether it looks like WordPress, and
   which of `rsync`, `php`, `mysql`, `mysqldump` and `wp` are available. The
   deploy fails here, before anything is written, if the target is unusable.

2. **Database export.** `wp sqlite export` dumps the local SQLite database as
   MySQL-dialect SQL. This runs before the file sync, so a failure to produce
   the dump costs nothing on the server.

3. **URL rewrite.** The dump is rewritten locally from the site's local
   address to the destination address (see below).

4. **File sync.** `rsync` copies the site directory, honouring `.deployignore`
   and the always-excluded list, and by default deleting remote files that no
   longer exist locally.

5. **Database import.** The dump is uploaded to the server's temp directory and
   imported, then removed.

Files go before the database so that a failure mid-transfer leaves the live
database intact.

## Implementation details

### Rewriting URLs in the dump

WordPress stores serialized PHP in `wp_options` and the `*meta` tables, and every
serialized string records its own byte length: `s:21:"http://localhost:8881"`. A
plain find-and-replace changes the string but not the length, PHP then refuses to
unserialize the value, and widget settings, theme mods and plugin options quietly
vanish. This is the single most common way a hand-rolled site migration breaks.

`packages/common/lib/sql-url-rewrite.ts` walks the dump, and for each serialized
string slices exactly the declared number of bytes, rewrites inside it, and
restates the length. It recurses, so serialized data nested inside serialized
data is corrected from the inside out. Three textual forms of the URL are
replaced: the plain one, the JSON-escaped one WordPress writes into block markup
(`http:\/\/…`), and the same with the backslashes the SQL dump doubles.

The rewrite happens on the dump rather than on the server for three reasons. It
works identically whether or not the server has WP-CLI. It never modifies the
local database to produce a deployable artifact. And it is a pure function over
a string, so it is cheap to test exhaustively.

Byte lengths, not character lengths: the dump is processed as latin1 so that one
JavaScript character is one byte, and multi-byte UTF-8 passes through untouched.

The source address is not only the site's current URL. Studio forces `WP_HOME`
and `WP_SITEURL` at runtime through an `auto_prepend_file`, so a site keeps
working after its port changes while the stale address stays in the database and
in saved content. The `siteurl` and `home` values found in the dump are rewritten
too.

### Importing on the server

With WP-CLI present, the import is `wp db import`, preceded by `wp db export` for
the safety copy and followed by a cache and rewrite flush. WP-CLI is detected by
actually running it against the remote path, because a `wp` on `$PATH` that
cannot bootstrap the install is worse than none. If it only works with
`--allow-root`, that is detected too and used for the rest of the deploy.

Without WP-CLI, the fallback reads the live credentials out of the server's
`wp-config.php` and pipes the dump into `mysql`. The credentials are read by
including the file in PHP and printing the constants from a shutdown handler:
including it always ends in a fatal error on its final `require_once` of
`wp-settings.php`, and the shutdown handler runs anyway. Parsing the file with a
regex instead would mangle passwords containing quotes or backslashes.

The credentials are written to a `mktemp` my.cnf with mode 600 and passed as
`--defaults-file`, never on the command line, where every user on the server
could read them out of the process list. Every script is piped to `bash -s` over
stdin for the same reason, and to avoid a second layer of shell quoting.

### What is never copied

Beyond `.deployignore` and Studio's export defaults, `DEPLOY_ALWAYS_EXCLUDED`
(`apps/cli/lib/deploy/excludes.ts`) covers two kinds of thing:

- `wp-config.php` belongs to the server. It holds that host's database
  credentials and salts, and replacing it points the live site at a database
  that does not exist.
- Studio's own local scaffolding: the SQLite integration that stands in for
  MySQL, and `wp-content/mu-plugins/99-studio-loader.php`, which requires files
  from a temp directory on the developer's machine. Both are meaningless or
  actively broken anywhere else.

The Studio-specific half mirrors what `DefaultExporter` skips, so a deployed
site and an exported archive hold the same files. Keep the two lists in step.

### Deleting removed files

`rsync --delete` is the default, so the server ends up matching the local site.
This is consistent with replacing the database on every push: both say "the
local site is the truth". It also means uploads added on the live site are
removed. Turn it off per target with `studio deploy set --no-delete`, or the
checkbox in the Deploy tab.

### Failure messages

`ssh` reports almost everything as exit code 255. `apps/cli/lib/deploy/ssh.ts`
matches the stderr text and turns the common cases — an untrusted host key, a
rejected key, a refused connection, a locked passphrase — into a sentence that
says what to do about it, keeping the original output as the cause.

Deploys run with `BatchMode=yes` whenever there is no terminal to type into,
which is the case when the desktop app forks the CLI. Without it, a key with a
passphrase would hang the deploy forever instead of failing with a message.

## Testing

`apps/cli/lib/deploy/tests/deploy-integration.test.ts` runs real deploys against
a stand-in for the server: `ssh` and `rsync` are replaced on `PATH` with scripts
that act locally, so the generated bash really executes and its output is really
parsed. That covers the file exclusions, the dry run, `.deployignore`, both
database paths, and the credential handling, without needing a server.

The URL rewriter has its own unit tests, which is where the serialized-length
edge cases live.
