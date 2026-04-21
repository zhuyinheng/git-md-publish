# git-md-publish

Publish public Markdown + their attachments from a git repo to a remote
branch. Designed for Obsidian vaults (or any Markdown repo) where only some
notes are meant to be public.

## Install

```sh
curl -fsSL https://github.com/zhuyinheng/git-md-publish/releases/latest/download/install.sh | sh
```

`install.sh` picks a channel automatically:

* **Node channel** (used when `node >= 20` is on `PATH`): downloads a
  single-file CJS bundle to `~/.local/lib/git-md-publish/git-md-publish.cjs`
  and a tiny shell wrapper to `~/.local/bin/git-md-publish` that delegates
  to `node`.
* **Binary channel** (used otherwise): downloads the prebuilt standalone
  binary for the host OS / arch straight to `~/.local/bin/git-md-publish`.
  No Node required.

Force one or the other with `GIT_MD_PUBLISH_CHANNEL=node` or
`GIT_MD_PUBLISH_CHANNEL=binary`. Before switching channels, clear the
previous install:

```sh
rm -f ~/.local/bin/git-md-publish
rm -rf ~/.local/lib/git-md-publish
```

## Try it

Publish the obsidian_test_vault fixture to a throwaway local mirror:

```sh
git clone https://github.com/zhuyinheng/obsidian_test_vault.git /tmp/vault
git-md-publish publish /tmp/vault remote=/tmp/vault-mirror branch=main
git --git-dir=/tmp/vault-mirror log --oneline main
```

Re-running the same publish produces the same commit oid — output is
deterministic (source HEAD + mtime in, identical snapshot commit out).

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

## What counts as public?

* A Markdown file with `public: true` in its YAML frontmatter is public.
* A Markdown file with `public: false` is private.
* Anything else inherits from the nearest `README.md` walking up the tree.
* Default if nothing is set: `false`.

Attachments (images, PDFs, ...) referenced by a public Markdown file are
included automatically. Standard Markdown links, reference links,
wikilinks, embeds, and a narrow allowlist of HTML tags
(`<a>`, `<img>`, `<video>`, `<audio>`, `<source>`) are all supported.

Tracked symlinks are preserved as-is; their targets are never dereferenced.
Submodules / gitlinks are skipped.

## Diagnostics

`git-md-publish` writes to `stderr` (not stdout, which is reserved for
pipeline output) when it finds something the publisher should know about:

```text
broken reference (missing):    Home.md -> img/nope.png
broken reference (not-public): Home.md -> Private/Secret.md
unsafe html (script):          note.md: <script>
unsafe html (event-handler):   note.md: onClick on <p>
```

* `missing` — the target path isn't in the tracked tree.
* `not-public` — the target resolves to a Markdown file that isn't public;
  `git-md-publish` does **not** drag it into the public mirror.
* `unsafe html` — a `<script>`, `<style>`, or inline event handler
  (`onclick=...` etc.) appears in a public Markdown file. `git-md-publish`
  never rewrites file contents, so these make it to the mirror verbatim;
  the warning just surfaces the fact.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for repo layout, tests, build,
and release workflow. Design docs live under [`dev_docs/`](./dev_docs) and
are the source of truth for behaviour.
