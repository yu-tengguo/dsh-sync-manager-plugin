// GitHub REST API client (contents API only — works where git:// or github.com
// push is blocked, per existing browser-tool uploader pattern).
// Token is NEVER stored here: it is passed in at call time from the caller
// (env var, DSH credentials, or local secret file resolved by the host plugin).

export class GhError extends Error {
  constructor(method, path, status, message) {
    super(`${method} ${path} -> HTTP ${status}: ${message}`);
    this.status = status;
    this.path = path;
  }
}

const BASE = "https://api.github.com";

function headers(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dsh-sync-manager",
    ...extra,
  };
}

export async function gh(token, method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(token, extra),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok && res.status !== 404) {
    throw new GhError(method, path, res.status, json?.message || text.slice(0, 300));
  }
  return { status: res.status, json };
}

/** @returns {{owner:string, repo:{...}}} — ensures the target repo exists. */
export async function ensureRepo(token, { name, description, isPrivate = true, ownerHint }) {
  const me = await gh(token, "GET", "/user");
  const owner = ownerHint || me.json.login;
  let repo = null;
  try {
    const created = await gh(token, "POST", "/user/repos", {
      name,
      description,
      private: isPrivate,
      auto_init: true,
    });
    repo = created.json;
  } catch (e) {
    if (e instanceof GhError && String(e.message).includes("already exists")) {
      const got = await gh(token, "GET", `/repos/${owner}/${name}`);
      repo = got.json;
    } else throw e;
  }
  return { owner, repo, branch: repo.default_branch || "main" };
}

/** Recursive file list of a repo branch (tree API). Returns [{path, sha, type}] */
export async function listRepoTree(token, { owner, repo, branch }) {
  const res = await gh(token, "GET", `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (res.status === 404) return [];
  const tree = (res.json?.tree || []).filter((t) => t.type === "blob");
  return tree.map((t) => ({ path: t.path, sha: t.sha, size: t.size }));
}

/** Read a file's decoded utf8 text. Returns null when missing. */
export async function readRepoFile(token, { owner, repo, path, branch }) {
  const res = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${branch}`);
  if (res.status === 404) return null;
  const content = res.json?.content;
  if (!content) return null;
  return { text: Buffer.from(content, "base64").toString("utf8"), sha: res.json.sha };
}

/** Put (create or overwrite) one file, utf8 content. */
export async function putRepoFile(token, { owner, repo, path, content, branch, message }) {
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  const existing = await readRepoFile(token, { owner, repo, path, branch });
  if (existing) body.sha = existing.sha;
  const res = await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${encodePath(path)}`, body);
  if (![200, 201].includes(res.status)) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json?.content?.sha || null;
}

export async function deleteRepoFile(token, { owner, repo, path, branch, message }) {
  const existing = await readRepoFile(token, { owner, repo, path, branch });
  if (!existing) return false;
  await gh(token, "DELETE", `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    message,
    sha: existing.sha,
    branch,
  });
  return true;
}

/** Returns {remoteFiles: Map<path, {sha,size}>, deleted: [], changed: []} — remote tree summary. */
export async function repoFileMap(token, { owner, repo, branch }) {
  const tree = await listRepoTree(token, { owner, repo, branch });
  return new Map(tree.map((t) => [t.path, t]));
}

function encodePath(p) {
  // contents API path may contain slashes; each segment should be encoded but keep '/'
  return p.split("/").map((s) => encodeURIComponent(s)).join("/");
}
