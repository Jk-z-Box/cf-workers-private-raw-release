const GITHUB_RAW_ORIGIN = "https://raw.githubusercontent.com";
const GITHUB_WEB_ORIGIN = "https://github.com";
const GITHUB_API_ORIGIN = "https://api.github.com";
const API_VERSION = "2022-11-28";

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    if (url.pathname === "/" && !env.GH_HOME_PATH) {
      return handleHome(request, env);
    }

    const access = authorizeRequest(url, env);
    if (access.response) return access.response;

    const targetUrl = createTargetUrl(url, env);
    const target = parseTarget(targetUrl, env);
    if (!target) {
      return new Response(env.ERROR || "无法解析GitHub路径。", { status: 400 });
    }

    if (isStrictMode(env) && !isStrictTargetAllowed(target, env)) {
      return new Response(env.ERROR || "当前路径未被允许。", { status: 403 });
    }

    if (target.type === "release") {
      return fetchReleaseAsset(target, access.githubToken, env);
    }

    return fetchRawFile(target.url, access.githubToken, env);
  }
};

function createTargetUrl(url, env) {
  if (url.pathname !== "/" || !env.GH_HOME_PATH) return url;

  const targetUrl = new URL(url);
  const [path, query = ""] = String(env.GH_HOME_PATH).split("?");
  targetUrl.pathname = `/${path.replace(/^\/+/, "")}`;
  targetUrl.search = query || url.search;
  return targetUrl;
}

function isStrictMode(env) {
  return ["1", "true", "yes", "on", "是", "开启", "開啟", "启用", "啟用"].includes(
    String(env.STRICT_MODE || "").trim().toLowerCase()
  );
}

function isStrictTargetAllowed(target, env) {
  if (!env.GH_NAME || !env.GH_REPO) return false;

  if (target.type === "release") {
    return target.owner === env.GH_NAME &&
      target.repo === env.GH_REPO &&
      (!env.GH_RELEASE_ASSET || safeDecode(target.assetName) === env.GH_RELEASE_ASSET) &&
      (!env.GH_RELEASE_TAG || target.selector === "tags" && target.ref === env.GH_RELEASE_TAG);
  }

  if (target.type === "raw") {
    const rawParts = parseRawUrl(target.url);
    if (!rawParts) return false;

    return rawParts.owner === env.GH_NAME &&
      rawParts.repo === env.GH_REPO &&
      (!env.GH_BRANCH || rawParts.branch === env.GH_BRANCH);
  }

  return false;
}

function parseRawUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.origin !== GITHUB_RAW_ORIGIN) return null;
  const [owner, repo, branch, ...pathParts] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo || !branch || !pathParts.length) return null;
  return { owner, repo, branch, path: pathParts.join("/") };
}

function authorizeRequest(url, env) {
  const pathTokenAuth = authorizeTokenPath(url, env);
  if (pathTokenAuth.matched) return pathTokenAuth;

  let githubToken;
  if (env.GH_TOKEN && env.TOKEN) {
    const providedToken = url.searchParams.get("token");
    if (!providedToken) {
      return { response: new Response("TOKEN不能为空", { status: 400 }) };
    }
    githubToken = env.TOKEN === providedToken ? env.GH_TOKEN : providedToken;
  } else {
    githubToken = url.searchParams.get("token") || env.GH_TOKEN || env.TOKEN;
  }

  return { githubToken };
}

function authorizeTokenPath(url, env) {
  if (!env.TOKEN_PATH) return { matched: false };

  const normalizedPathname = safeDecode(url.pathname).toLowerCase();

  for (const item of splitEnvList(env.TOKEN_PATH)) {
    const parts = item.split("@");
    if (parts.length !== 2) continue;

    const [requiredToken, pathPart] = parts;
    const normalizedPath = `/${pathPart.trim().toLowerCase().replace(/^\/+/, "")}`;
    const pathMatches = normalizedPathname === normalizedPath ||
      normalizedPathname.startsWith(`${normalizedPath}/`);

    if (!pathMatches) continue;

    const providedToken = url.searchParams.get("token");
    if (!providedToken) {
      return { matched: true, response: new Response("TOKEN不能为空", { status: 400 }) };
    }
    if (providedToken !== requiredToken.trim()) {
      return { matched: true, response: new Response("TOKEN错误", { status: 403 }) };
    }
    if (!env.GH_TOKEN) {
      return {
        matched: true,
        response: new Response("服务器GitHub TOKEN配置错误", { status: 500 })
      };
    }

    return { matched: true, githubToken: env.GH_TOKEN };
  }

  return { matched: false };
}

function parseTarget(url, env) {
  const pathname = safeDecode(url.pathname);
  const fullPath = pathname.replace(/^\/+/, "");

  const rawUrl = parseFullUrlInPath(pathname, GITHUB_RAW_ORIGIN);
  if (rawUrl) return { type: "raw", url: rawUrl };

  const releaseUrl = parseFullUrlInPath(pathname, GITHUB_WEB_ORIGIN);
  if (releaseUrl) return parseReleaseUrl(releaseUrl);

  const releaseTarget = parseReleasePath(fullPath, env);
  if (releaseTarget) return releaseTarget;

  return {
    type: "raw",
    url: buildRawUrl(pathname, env)
  };
}

function parseFullUrlInPath(pathname, origin) {
  const index = pathname.toLowerCase().indexOf(origin.toLowerCase());
  if (index === -1) return null;
  return `${origin}${pathname.slice(index + origin.length)}`;
}

function buildRawUrl(pathname, env) {
  let rawUrl = GITHUB_RAW_ORIGIN;

  if (env.GH_NAME) {
    rawUrl += `/${env.GH_NAME}`;
    if (env.GH_REPO) {
      rawUrl += `/${env.GH_REPO}`;
      if (env.GH_BRANCH) rawUrl += `/${env.GH_BRANCH}`;
    }
  }

  return rawUrl + pathname;
}

function parseReleaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.hostname !== "github.com") return null;
  return parseReleasePath(parsed.pathname.replace(/^\/+/, ""));
}

function parseReleasePath(path, env = {}) {
  const parts = path.split("/").filter(Boolean);

  const customReleasePathTarget = parseCustomReleasePath(parts, env);
  if (customReleasePathTarget) return customReleasePathTarget;

  if (isDefaultReleaseAlias(parts) && env.GH_NAME && env.GH_REPO && env.GH_RELEASE_ASSET) {
    return {
      type: "release",
      owner: env.GH_NAME,
      repo: env.GH_REPO,
      selector: env.GH_RELEASE_TAG ? "tags" : "latest",
      ref: env.GH_RELEASE_TAG || "latest",
      assetName: env.GH_RELEASE_ASSET
    };
  }

  if (parts[0] === "releases" && env.GH_NAME && env.GH_REPO) {
    return parseReleaseParts([env.GH_NAME, env.GH_REPO, ...parts]);
  }

  if (parts[0] === "download" && env.GH_NAME && env.GH_REPO) {
    return parseReleaseParts([env.GH_NAME, env.GH_REPO, "releases", ...parts]);
  }

  return parseReleaseParts(parts);
}

function parseCustomReleasePath(parts, env) {
  if (!env.GH_NAME || !env.GH_REPO || !env.GH_RELEASE_PATH) return null;

  const prefixParts = String(env.GH_RELEASE_PATH).split("/").filter(Boolean);
  if (!prefixParts.length) return null;
  if (!startsWithParts(parts, prefixParts)) return null;

  const assetParts = parts.slice(prefixParts.length);
  const assetName = assetParts.length ? assetParts.join("/") : env.GH_RELEASE_ASSET;
  if (!assetName) return null;

  return {
    type: "release",
    owner: env.GH_NAME,
    repo: env.GH_REPO,
    selector: env.GH_RELEASE_TAG ? "tags" : "latest",
    ref: env.GH_RELEASE_TAG || "latest",
    assetName
  };
}

function startsWithParts(parts, prefixParts) {
  if (parts.length < prefixParts.length) return false;
  return prefixParts.every((part, index) => parts[index] === part);
}

function isDefaultReleaseAlias(parts) {
  return parts.length === 1 && ["download", "latest", "release"].includes(parts[0]);
}

function parseReleaseParts(parts) {
  if (parts.length < 6) return null;
  const [owner, repo, releases, selector] = parts;
  if (!owner || !repo || releases !== "releases") return null;

  let ref;
  let assetParts;
  if (selector === "latest" && parts[4] === "download") {
    ref = "latest";
    assetParts = parts.slice(5);
  } else if (selector === "tags" && parts[5] === "download") {
    ref = parts[4];
    assetParts = parts.slice(6);
  } else {
    return null;
  }

  const assetName = assetParts.join("/");
  if (!ref || !assetName) return null;

  return {
    type: "release",
    owner,
    repo,
    selector,
    ref,
    assetName
  };
}

async function fetchRawFile(rawUrl, githubToken, env) {
  const headers = createGithubHeaders(githubToken);
  const response = await fetch(rawUrl, { headers });

  if (response.ok) {
    return new Response(response.body, {
      status: response.status,
      headers: filterResponseHeaders(response.headers)
    });
  }

  return new Response(env.ERROR || "无法获取文件，检查路径或TOKEN是否正确。", {
    status: response.status
  });
}

async function fetchReleaseAsset(target, githubToken, env) {
  const releaseApiUrl = target.selector === "latest"
    ? `${GITHUB_API_ORIGIN}/repos/${target.owner}/${target.repo}/releases/latest`
    : `${GITHUB_API_ORIGIN}/repos/${target.owner}/${target.repo}/releases/tags/${encodeURIComponent(target.ref)}`;

  const releaseResponse = await fetch(releaseApiUrl, {
    headers: createGithubHeaders(githubToken)
  });

  if (!releaseResponse.ok) {
    return new Response(env.ERROR || "无法获取Release，检查路径或TOKEN是否正确。", {
      status: releaseResponse.status
    });
  }

  const release = await releaseResponse.json();
  const decodedName = safeDecode(target.assetName);
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item.name === decodedName)
    : null;

  if (!asset?.url) {
    return new Response(env.ERROR || "Release文件不存在。", { status: 404 });
  }

  const assetResponse = await fetch(asset.url, {
    headers: createGithubHeaders(githubToken, "application/octet-stream"),
    redirect: "follow"
  });

  if (!assetResponse.ok) {
    return new Response(env.ERROR || "无法下载Release文件，检查TOKEN权限。", {
      status: assetResponse.status
    });
  }

  const headers = filterResponseHeaders(assetResponse.headers);
  headers.set("Content-Disposition", contentDisposition(decodedName));
  if (asset.content_type && !headers.has("Content-Type")) {
    headers.set("Content-Type", asset.content_type);
  }

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    headers
  });
}

function createGithubHeaders(token, accept = "application/vnd.github+json") {
  const headers = new Headers({
    "Accept": accept,
    "User-Agent": "cf-workers-private-raw-release",
    "X-GitHub-Api-Version": API_VERSION
  });

  if (token) headers.set("Authorization", `Bearer ${token}`);

  return headers;
}

function filterResponseHeaders(headers) {
  const next = new Headers(headers);
  next.delete("content-security-policy");
  next.delete("content-security-policy-report-only");
  next.delete("set-cookie");
  return next;
}

async function handleHome(request, env) {
  const envKey = env.URL302 ? "URL302" : env.URL ? "URL" : null;
  if (envKey) {
    const urls = splitEnvList(env[envKey]);
    const target = urls[Math.floor(Math.random() * urls.length)];
    return envKey === "URL302" ? Response.redirect(target, 302) : fetch(new Request(target, request));
  }

  return new Response(await nginx(), {
    headers: { "Content-Type": "text/html; charset=UTF-8" }
  });
}

function splitEnvList(value) {
  return String(value || "")
    .replace(/[ |"'\r\n]+/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .split(",")
    .filter(Boolean);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function contentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function nginx() {
  return `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working.
Further configuration is required.</p>
<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;
}

export const internals = {
  parseTarget,
  parseReleasePath,
  createTargetUrl,
  isStrictMode,
  isStrictTargetAllowed,
  authorizeRequest,
  splitEnvList
};
