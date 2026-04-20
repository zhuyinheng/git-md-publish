# Contributing

This document covers how the project is organised, how to run tests, how
the release pipeline builds artefacts, and how to cut a new version.
End-user install / usage lives in [`README.md`](./README.md). Behavioural
specs live in [`dev_docs/`](./dev_docs).

## Repository layout

```
src/
  cli.js          CLI entry point — argv parsing, stdin/stdout wiring.
  scan.js         scan: public-file discovery on HEAD's tree.
  export.js       export: git archive driver.
  sync.js         sync: tar → snapshot commit → remote push.
  publish.js      publish: scan + export + sync in one process.
  frontmatter.js  Frontmatter reader built on vfile-matter.
  references.js   Markdown / HTML reference extractor (remark AST +
                  hast-util-from-html).
  tar.js          Pure-JS tar reader used by sync.
  git.js          Thin host-git wrapper.
  io.js           Shared stream collection helper.
test/
  helpers.js      Shared test fixtures + CLI runner.
  local/          No-GitHub tests — run by `npm test`.
  remote/         GitHub-backed tests — opt-in via env vars.
install/
  install.sh.tmpl Installer template; rendered per release.
scripts/
  bundle.js              Shared esbuild bundle step.
  build.js               Standalone binary build per (os, arch).
  build-js.js            Single-file Node bundle (`git-md-publish.cjs`).
  generate-install.js    Render install.sh for a given release tag.
.github/workflows/
  release.yml     Build + release pipeline.
dev_docs/         Design docs (the source of truth for behaviour).
```

Every file in `src/` points back to a named design doc under `dev_docs/`
via its top-of-file comment.

## Running tests

Local tests cover `scan`, `export`, `sync` against a local bare repo,
the CLI surface, installer rendering, and the release asset list. They
don't need GitHub credentials.

```sh
npm test
```

Remote tests (GitHub SSH push, live publish smoke, release asset URLs)
live in `test/remote/` and skip themselves when their env vars are
absent:

```sh
GMP_LIVE_REMOTE=git@github.com:you/obsidian_test_vault_live.git \
GMP_LIVE_BRANCH=claude-live-smoke \
npm run test:remote
```

See [`test/remote/README.md`](./test/remote/README.md) for the full
env-var list.

The test helpers redirect `HOME` to a throwaway dir with a minimal
`.gitconfig`, so tests pass on any environment regardless of the caller's
global git identity.

## Build pipeline

There are two release artefact flavours:

1. **Single-file CJS bundle** (`dist/git-md-publish.cjs`) — used by the
   Node install channel. Produced by:
   ```sh
   node scripts/build-js.js
   ```
   Internally runs `esbuild` against `src/cli.js` with all deps inlined.
   `.cjs` suffix so Node always resolves it as CommonJS, regardless of
   any sibling `package.json` `"type": "module"`.

2. **Standalone binaries** (`dist/git-md-publish-<os>-<arch>`) — used by
   the Binary install channel. Produced by:
   ```sh
   node scripts/build.js <os> <arch>    # os: linux | darwin, arch: x64 | arm64
   ```
   Internally: esbuild bundle → Node SEA blob with `useCodeCache: false`
   (for architecture independence) → postject injection into a
   downloaded `nodejs.org` binary → `codesign --sign -` on darwin.

### Build host constraints

* Linux host: can cross-build `linux-arm64` (postject handles ELF from
  either arch).
* macOS host (Apple Silicon): builds `darwin-arm64` natively and
  cross-builds `darwin-x64` via Rosetta-parseable Mach-O writing.
* Linux host → `darwin-*`: **not supported** — the cross-compiled
  Mach-O can't be signed, and macOS kills unsigned arm64 binaries at
  exec. `scripts/build.js` fails loudly at the `codesign` step.

The release workflow splits jobs across `ubuntu-latest` and `macos-15`
accordingly.

## Installer

`install/install.sh.tmpl` is a portable POSIX shell script. At release
time, `scripts/generate-install.js` substitutes two placeholders:

* `__RELEASE_TAG__` — the version tag (e.g. `v0.1.0`).
* `__ASSET_BASE_URL__` — `https://github.com/<owner>/<repo>/releases/download/<tag>`.

To render it locally (for debugging):

```sh
node scripts/generate-install.js v0.1.0 owner/repo dist/install.sh
```

## Releasing

1. Merge your changes to `main`.
2. Tag the release commit:
   ```sh
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```
3. The tag push triggers `.github/workflows/release.yml`, which:
   * runs `npm run test:local`,
   * builds one standalone binary per (os, arch) on its native runner,
   * builds the single-file JS bundle,
   * renders `install.sh`,
   * creates a draft GitHub Release, uploads the payload assets, then
     uploads `install.sh`, then publishes the release.

The fixed asset filenames (see `dev_docs/design_release.md` and
`test/local/release.test.js`) are:

```
install.sh
git-md-publish.cjs
git-md-publish-darwin-arm64
git-md-publish-darwin-x64
git-md-publish-linux-arm64
git-md-publish-linux-x64
```

`https://github.com/<owner>/<repo>/releases/latest/download/install.sh`
always resolves to the newest release.

## Design docs

[`dev_docs/`](./dev_docs) is the source of truth for behaviour. Any
change to `scan` / `export` / `sync` / `publish` / installer / release
semantics must be reflected there before or alongside the code change:

* [`design_scan.md`](./dev_docs/design_scan.md)
* [`design_export.md`](./dev_docs/design_export.md)
* [`design_sync.md`](./dev_docs/design_sync.md)
* [`design_cli.md`](./dev_docs/design_cli.md)
* [`design_install.md`](./dev_docs/design_install.md)
* [`design_release.md`](./dev_docs/design_release.md)
* [`design_tests.md`](./dev_docs/design_tests.md)
