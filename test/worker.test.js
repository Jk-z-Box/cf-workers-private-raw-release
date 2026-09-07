import test from "node:test";
import assert from "node:assert/strict";

import worker, { internals } from "../src/worker.js";

test("builds a raw URL from hidden owner, repo, and branch", () => {
  const target = internals.parseTarget(
    new URL("https://worker.example.com/config/app.yaml"),
    { GH_NAME: "owner", GH_REPO: "repo", GH_BRANCH: "main" }
  );

  assert.equal(target.type, "raw");
  assert.equal(target.url, "https://raw.githubusercontent.com/owner/repo/main/config/app.yaml");
});

test("maps home path to configured default target path", () => {
  const targetUrl = internals.createTargetUrl(
    new URL("https://worker.example.com/?token=public"),
    { GH_HOME_PATH: "releases/latest/download/app.zip" }
  );

  assert.equal(targetUrl.pathname, "/releases/latest/download/app.zip");
  assert.equal(targetUrl.search, "?token=public");
});

test("uses configured default target query for home path", () => {
  const targetUrl = internals.createTargetUrl(
    new URL("https://worker.example.com/"),
    { GH_HOME_PATH: "releases/latest/download/app.zip?token=public" }
  );

  assert.equal(targetUrl.pathname, "/releases/latest/download/app.zip");
  assert.equal(targetUrl.search, "?token=public");
});

test("parses latest release download path", () => {
  const target = internals.parseReleasePath("owner/repo/releases/latest/download/app.zip");

  assert.deepEqual(target, {
    type: "release",
    owner: "owner",
    repo: "repo",
    selector: "latest",
    ref: "latest",
    assetName: "app.zip"
  });
});

test("parses hidden latest release download path", () => {
  const target = internals.parseReleasePath("releases/latest/download/app.zip", {
    GH_NAME: "owner",
    GH_REPO: "repo"
  });

  assert.equal(target.owner, "owner");
  assert.equal(target.repo, "repo");
  assert.equal(target.assetName, "app.zip");
});

test("parses default release asset aliases", () => {
  const target = internals.parseReleasePath("download", {
    GH_NAME: "owner",
    GH_REPO: "repo",
    GH_RELEASE_ASSET: "app.zip"
  });

  assert.deepEqual(target, {
    type: "release",
    owner: "owner",
    repo: "repo",
    selector: "latest",
    ref: "latest",
    assetName: "app.zip"
  });
});

test("parses default release asset alias with explicit tag", () => {
  const target = internals.parseReleasePath("latest", {
    GH_NAME: "owner",
    GH_REPO: "repo",
    GH_RELEASE_ASSET: "app.zip",
    GH_RELEASE_TAG: "v1.2.3"
  });

  assert.deepEqual(target, {
    type: "release",
    owner: "owner",
    repo: "repo",
    selector: "tags",
    ref: "v1.2.3",
    assetName: "app.zip"
  });
});

test("parses custom release path with asset in URL", () => {
  const target = internals.parseReleasePath("dl/app.zip", {
    GH_NAME: "owner",
    GH_REPO: "repo",
    GH_RELEASE_PATH: "dl"
  });

  assert.deepEqual(target, {
    type: "release",
    owner: "owner",
    repo: "repo",
    selector: "latest",
    ref: "latest",
    assetName: "app.zip"
  });
});

test("parses custom release path with default asset", () => {
  const target = internals.parseReleasePath("files/latest", {
    GH_NAME: "owner",
    GH_REPO: "repo",
    GH_RELEASE_PATH: "files/latest",
    GH_RELEASE_ASSET: "app.zip"
  });

  assert.deepEqual(target, {
    type: "release",
    owner: "owner",
    repo: "repo",
    selector: "latest",
    ref: "latest",
    assetName: "app.zip"
  });
});

test("strict mode allows configured release target", () => {
  const target = internals.parseReleasePath("owner/repo/releases/latest/download/app.zip");

  assert.equal(internals.isStrictTargetAllowed(target, {
    STRICT_MODE: "true",
    GH_NAME: "owner",
    GH_REPO: "repo"
  }), true);
});

test("strict mode rejects release targets outside configured repo", () => {
  const target = internals.parseReleasePath("other/repo/releases/latest/download/app.zip");

  assert.equal(internals.isStrictTargetAllowed(target, {
    STRICT_MODE: "true",
    GH_NAME: "owner",
    GH_REPO: "repo"
  }), false);
});

test("strict mode rejects release assets outside configured asset", () => {
  const target = internals.parseReleasePath("owner/repo/releases/latest/download/other.zip");

  assert.equal(internals.isStrictTargetAllowed(target, {
    STRICT_MODE: "true",
    GH_NAME: "owner",
    GH_REPO: "repo",
    GH_RELEASE_ASSET: "app.zip"
  }), false);
});

test("strict mode rejects raw URLs outside configured repo", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example.com/https://raw.githubusercontent.com/other/repo/main/file.txt"),
      { STRICT_MODE: "true", GH_NAME: "owner", GH_REPO: "repo", GH_BRANCH: "main" }
    );

    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("uses GH_TOKEN after validating TOKEN", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });
    return new Response("raw-content", { status: 200 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example.com/owner/repo/main/file.txt?token=public"),
      { GH_TOKEN: "github-secret", TOKEN: "public" }
    );

    assert.equal(await response.text(), "raw-content");
    assert.equal(calls[0].url, "https://raw.githubusercontent.com/owner/repo/main/file.txt");
    assert.equal(calls[0].headers.get("Authorization"), "Bearer github-secret");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("uses GH_TOKEN without requiring TOKEN", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });
    return new Response("raw-content", { status: 200 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example.com/owner/repo/main/file.txt"),
      { GH_TOKEN: "github-secret" }
    );

    assert.equal(await response.text(), "raw-content");
    assert.equal(calls[0].headers.get("Authorization"), "Bearer github-secret");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("allows unauthenticated requests when no token variables are set", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });
    return new Response("public-content", { status: 200 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example.com/owner/repo/main/file.txt"),
      {}
    );

    assert.equal(await response.text(), "public-content");
    assert.equal(calls[0].headers.has("Authorization"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("downloads release asset through the GitHub API asset URL", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });

    if (String(url).endsWith("/releases/latest")) {
      return Response.json({
        assets: [
          {
            name: "app.zip",
            url: "https://api.github.com/repos/owner/repo/releases/assets/123",
            content_type: "application/zip"
          }
        ]
      });
    }

    return new Response("zip-bytes", {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example.com/owner/repo/releases/latest/download/app.zip?token=public"),
      { GH_TOKEN: "github-secret", TOKEN: "public" }
    );

    assert.equal(await response.text(), "zip-bytes");
    assert.equal(calls[0].url, "https://api.github.com/repos/owner/repo/releases/latest");
    assert.equal(calls[1].url, "https://api.github.com/repos/owner/repo/releases/assets/123");
    assert.equal(calls[1].headers.get("Accept"), "application/octet-stream");
    assert.equal(calls[1].headers.get("Authorization"), "Bearer github-secret");
    assert.match(response.headers.get("Content-Disposition"), /filename="app\.zip"/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rejects invalid TOKEN_PATH token", () => {
  const result = internals.authorizeRequest(
    new URL("https://worker.example.com/private/file.txt?token=wrong"),
    { GH_TOKEN: "github-secret", TOKEN_PATH: "right@private" }
  );

  assert.equal(result.response.status, 403);
});
