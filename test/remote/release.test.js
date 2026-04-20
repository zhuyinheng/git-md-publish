// Remote release test: for a given releaseTag, verify the published assets
// are reachable at the URLs the design promises.
// See dev_docs/design_release.md and dev_docs/design_tests.md.

import { test } from "node:test";
import assert from "node:assert/strict";

const OWNER_REPO = process.env.GMP_RELEASE_REPO;
const TAG = process.env.GMP_RELEASE_TAG;

const ASSETS = [
  "install.sh",
  "git-md-publish-darwin-arm64",
  "git-md-publish-darwin-x64",
  "git-md-publish-linux-arm64",
  "git-md-publish-linux-x64",
];

async function headOk(url) {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return res.status;
}

test(
  "remote release: tag-specific asset URLs are reachable",
  { skip: (!OWNER_REPO || !TAG) && "set GMP_RELEASE_REPO and GMP_RELEASE_TAG" },
  async () => {
    for (const name of ASSETS) {
      const url = `https://github.com/${OWNER_REPO}/releases/download/${TAG}/${name}`;
      const status = await headOk(url);
      assert.equal(status, 200, `expected 200 for ${url}, got ${status}`);
    }
  },
);

test(
  "remote release: /releases/latest/download/install.sh is reachable",
  { skip: !OWNER_REPO && "set GMP_RELEASE_REPO" },
  async () => {
    const url = `https://github.com/${OWNER_REPO}/releases/latest/download/install.sh`;
    const status = await headOk(url);
    assert.equal(status, 200, `expected 200 for ${url}, got ${status}`);
  },
);
