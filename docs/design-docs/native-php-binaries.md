# Native PHP Binaries

Sites that use the native PHP runtime run against a prebuilt PHP CLI binary that
Studio downloads and installs per PHP minor version. This fork consumes those
binaries; it does not build or publish them. The build strategy is recorded here
because it explains the shape of the artifacts the runtime has to handle, and
because rebuilding them is the fallback if the upstream CDN ever stops serving
them.

The two platforms use different build strategies because static-php-cli only
supports shared extensions on Unix-like targets:

- **macOS** checks out `crazywhalecc/static-php-cli`, pins the requested SPC
  ref, and runs `spc build "$extensions" --build-shared=xdebug --build-cli`.
  Every extension lives inside the `php` binary; Xdebug ships as the only
  loadable `.so` under `ext/` because it's a Zend extension that has to dlopen
  at startup.
- **Windows** downloads the matching `windows.php.net` prebuilt PHP, overlays
  the Xdebug DLL from `xdebug.org`, and fetches each missing PECL extension
  (apcu, igbinary, redis, ssh2, yaml) from `downloads.php.net/~windows/pecl`
  with the newest published version that has a build for the requested
  `PHP_MINOR` + VS toolchain. It also copies the matching x64 VC143 runtime
  from the Visual Studio 2022 runner beside `php.exe`, so the package does not
  depend on a machine-wide Visual C++ Redistributable installation.

The artifact shapes diverge as a result: the macOS `ext/` directory contains
only `xdebug.so`, while the Windows `ext/` directory contains a
`php_<name>.dll` for every non-built-in extension. Both archives still expose
a stable `runtime.json` manifest with `phpVersion`, `extensionDir`, and
`xdebug` paths. The manifest also records `packageVersion`, the required
engineer-chosen immutable packaging identifier, and `packageId`, its
PHP-qualified CDN and local-directory identifier. All artifacts ship with
`.sha256` sidecars.

The Studio consumer needs to know this divergence when launching the binary:
on macOS the baked-in extensions are implicit and need no `extension=…` flags,
while on Windows it must pass `-d extension_dir=ext -d extension=<name>` for
each extension it wants enabled. Xdebug is loaded the same way on both
platforms: `-d zend_extension=ext/xdebug.so` (macOS) or
`-d zend_extension=ext/php_xdebug.dll` (Windows).

The published artifacts are:

- `php-<patch>-cli-macos-aarch64.zip`
- `php-<patch>-cli-macos-x86_64.zip`
- `php-<patch>-cli-windows-x86_64.zip`

Windows ARM64 Studio builds use the Windows x64 PHP binary under Windows 11
emulation. Native Windows ARM64 PHP binaries are not built.

Artifacts are published to a CDN as ZIP files for macOS and Windows, each with a
`.sha256` sidecar. `packages/common/lib/php-binary-cdn-metadata.mjs` records the
URL and hash for every PHP minor version Studio offers. Package identifiers are
immutable: a rebuild of the same upstream PHP release gets a new
`packageVersion`, because released Studio versions pin an artifact's URL and
SHA-256 and replacing its bytes would break their checksum verification.

At runtime, Studio uses `packages/common/lib/php-binary-cdn-metadata.mjs` as the
source of truth for the requested PHP minor version. Packaged Studio builds
ship the recommended PHP version under the app resources
`php-bin/<package-id>/`;
a CLI migration copies that directory into the writable install location if the
destination package folder does not exist. Studio downloads other PHP versions
on demand from manifest URLs, then verifies the checked-in SHA-256 before
extracting the archive. If metadata is missing for the requested device, native
PHP install fails for that version.

Downloaded binaries are installed under
`~/.studio/php-bin/<package-id>/`, for example
`~/.studio/php-bin/8.4.20-studio-1/php`. Metadata without a `packageVersion`
falls back to the PHP patch for backward compatibility. This lets Studio
download either a new PHP patch or a new packaging revision without replacing
a binary that an existing native PHP process is still using.

