# git-md-publish

Publish public Markdown + their attachments from a git repo to a remote
branch. Designed for Obsidian vaults (or any Markdown repo) where only some
notes are meant to be public.

The authoritative design lives in [`dev_docs/`](./dev_docs). This README is
the user / reviewer-facing overview.

## Install

```sh
curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | sh
```

`install.sh` picks a channel automatically:

* **Node channel** (used when `node >= 20` is on `PATH`): downloads a
  single-file CJS bundle to `~/.local/lib/git-md-publish/git-md-publish.cjs`
  and a tiny shell wrapper to `~/.local/bin/git-md-publish` that delegates
  to `node`. Avoids SEA / Mach-O signing entirely.
* **Binary channel** (used otherwise): downloads the prebuilt standalone
  binary for the host OS / arch straight to `~/.local/bin/git-md-publish`.
  No Node required.

Force one or the other with `GIT_MD_PUBLISH_CHANNEL=node` or
`GIT_MD_PUBLISH_CHANNEL=binary`.

### Try it against the test vault

Same vault used by the test suite, either channel works:

```sh
# Node channel (picked automatically if node >= 20 is on PATH)
curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | sh

# Binary channel (force standalone binary even if node is available)
curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh \
  | GIT_MD_PUBLISH_CHANNEL=binary sh

# Either channel: publish obsidian_test_vault to a throwaway local mirror
git clone https://github.com/<owner>/obsidian_test_vault.git /tmp/vault
git-md-publish publish /tmp/vault remote=/tmp/vault-mirror branch=main
git --git-dir=/tmp/vault-mirror log --oneline main
```

Re-running the same publish must produce the same commit oid — output is
deterministic (source HEAD + mtime in, identical snapshot commit out).

Before switching channels, clear the previous install:

```sh
rm -f ~/.local/bin/git-md-publish
rm -rf ~/.local/lib/git-md-publish
```

## Usage

```sh
# End-to-end: scan + export + sync in one step.
git-md-publish publish <repoRoot> remote=<remote> branch=<branch>

# Or piece by piece (same result):
git-md-publish scan <repoRoot> \
  | git-md-publish export <repoRoot> \
  | git-md-publish sync remote=<remote> branch=<branch>
```

`remote` can be either:

* a GitHub remote — `git@github.com:user/repo.git`
* a local folder path — `git-md-publish` creates / reuses a managed bare
  repo there

### What counts as public?

* A Markdown file with `public: true` in its YAML frontmatter is public.
* A Markdown file with `public: false` is private.
* Anything else inherits from the nearest `README.md` walking up the tree.
* Default if nothing is set: `false`.

Attachments (images, PDFs, ...) referenced by a public Markdown file are
included automatically. Standard links, reference links, wikilinks, and
embeds are all supported.

Tracked symlinks and submodules are skipped.

## Repository layout

```
src/
  cli.js         CLI entry point, argv parsing, stdin/stdout wiring.
  scan.js        scan: public-file discovery on HEAD's tree.
  export.js     export: git archive driver.
  sync.js        sync: tar → snapshot commit → remote push.
  publish.js     publish: scan + export + sync in one process.
  frontmatter.js YAML frontmatter parser.
  references.js  Markdown link / wikilink / embed extractor.
  tar.js         Pure-JS tar reader used by sync.
  git.js         Thin host-git wrapper.
test/
  local/         No-GitHub tests — run by default.
  remote/        GitHub-backed tests — opt-in via env vars.
install/
  install.sh.tmpl Template for the installer; rendered per release.
scripts/
  bundle.js              Shared esbuild bundle step.
  build.js               Standalone binary build per (os, arch).
  build-js.js            Single-file Node bundle (`git-md-publish.cjs`).
  generate-install.js    Render install.sh for a given release tag.
.github/workflows/
  release.yml    Build + release pipeline.
dev_docs/        Design docs (the source of truth for behaviour).
```

Every file in `src/` ties back to a named design doc under `dev_docs/`; the
top-of-file comment points at the relevant one.

## Testing

Local tests — no GitHub credentials needed — cover `scan`, `export`, `sync`
to a local bare repo, the CLI surface, installer rendering, and the release
asset list:

```sh
npm test
```

Remote tests (GitHub SSH push, live publish smoke, release asset URLs) live
in `test/remote/` and skip themselves when their env vars are absent:

```sh
GMP_LIVE_REMOTE=git@github.com:you/obsidian_test_vault_live.git \
GMP_LIVE_BRANCH=claude-live-smoke \
npm run test:remote
```

See `test/remote/README.md` for the full env-var list.
