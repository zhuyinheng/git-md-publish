# Remote tests

Tests that touch GitHub — either via the SSH remote or the GitHub REST API —
live here. The split is defined in `dev_docs/design_tests.md`:

> 任何涉及 GitHub 认证或 GitHub remote 的测试，都放在 `remote`

## Requirements

* A working SSH key accepted by GitHub
  (`git@github.com:<you>/obsidian_test_vault_live.git` must be pushable).
* `GITHUB_TOKEN` in the environment for the release API test.
* Network access.

## Env vars

| Variable | Purpose |
|----------|---------|
| `GMP_SOURCE_VAULT` | HTTPS URL of the source vault (default: the `obsidian_test_vault` published repo). |
| `GMP_LIVE_REMOTE` | SSH remote for the live target (e.g. `git@github.com:you/obsidian_test_vault_live.git`). |
| `GMP_LIVE_BRANCH` | Branch used for live smoke runs (default: `claude-live-smoke`). |
| `GITHUB_TOKEN` | Only required for the release API test. |

Every test skips itself cleanly when a required env var is missing, so
`npm run test:remote` is safe to run in a cold environment.
