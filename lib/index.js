// dsh-sync-manager — host half.
// 盘点本机插件/skills，经 GitHub REST 同步到用户仓库；PAT 只经凭据服务按名解析，绝不上传。
// 复刻 dsh-ego-browser：settings 命名空间 + webServer 前缀路由 /sync/api。

import z from "schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { buildSnapshot, dshHome, profileDir } from "../core/src/scanner.mjs";
import { scanText } from "../core/src/secret-scan.mjs";
import { gatherLocalFiles, buildPushPlan } from "../core/src/plan.mjs";
import { ensureRepo, gh, putRepoFile, deleteRepoFile, repoFileMap } from "../core/src/github.mjs";
import { buildRestorePlan } from "../core/src/restore.mjs";
import { installPlugin, removePlugin, ensureBundles, pullRepoToTemp, rmTemp, applyRestorePlan, SPEC_RE, NAME_RE } from "./hostops.mjs";

export const name = "sync-manager";
export const inject = ["settings"];

const Config = z.object({
  repoOwner: z.string().description("GitHub 用户名（留空 = 按 token 自动识别）").default(""),
  repoName: z.string().description("备份仓库名").default("dsh-sync-manager"),
  branch: z.string().description("目标分支").default("main"),
  tokenEnv: z.string().role("credential-ref").description("GitHub PAT 的凭据名（值存于 .credentials.yaml refs，绝不进入仓库）").default("GITHUB_SYNC_TOKEN"),
  isPrivate: z.boolean().description("新建仓库为私有").default(true),
  askOnChange: z.boolean().description("增删插件/skill 后询问是否同步").default(true),
});

const NS = settingsNamespace("sync-manager");
const API_PREFIX = "/sync/api";

const DEFAULT_CFG = {
  repoOwner: "",
  repoName: "dsh-sync-manager",
  branch: "main",
  tokenEnv: "GITHUB_SYNC_TOKEN",
  isPrivate: true,
  askOnChange: true,
};

// ---------- helpers ----------
function ok(data) { return { ok: true, data }; }
function err(code, message) { return { ok: false, error: { code, message } }; }
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function writeJson(res, status, body) {
  if (!res.headersSent) res.statusCode = status;
  res.setHeader?.("content-type", "application/json");
  res.end(JSON.stringify(body));
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}
function sanitizeOriginCheck(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost;
  try { originHost = new URL(origin).host; } catch { return false; }
  return !!req.headers.host && originHost === req.headers.host;
}

// ---------- token / repo ----------
async function resolveToken(ctx, envName) {
  try {
    const creds = ctx.get?.("credentials");
    if (creds?.resolve) {
      const hit = await creds.resolve(credentialRef(envName));
      if (hit?.value) return hit.value;
    }
  } catch { /* fall through */ }
  return process.env[envName] || null;
}

async function resolveOwner(token, cfg) {
  if (cfg.repoOwner) return cfg.repoOwner;
  if (!token) return "";
  const me = await gh(token, "GET", "/user");
  return me.json?.login || "";
}

/** 推送到远端；期望型失败抛 ApiError(400|409)。 */
async function pushAll(token, cfg) {
  const owner = await resolveOwner(token, cfg);
  if (!owner) throw new ApiError(400, "no-owner", "无法识别 GitHub 用户名");
  const snap = buildSnapshot();
  const local = gatherLocalFiles(snap);
  const real = [];
  for (const [path, f] of local) {
    for (const hit of scanText(f.content, path)) {
      if (hit.placeholder) continue; // 模板文档占位示例放行
      real.push(hit);
      if (real.length > 20) break;
    }
    if (real.length > 20) break;
  }
  if (real.length) {
    throw new ApiError(409, "secret-blocked", `检测到疑似密钥，已拒绝上传（${real.length} 处，样例：${real[0].sample} @ ${real[0].source}）`);
  }
  await ensureRepo(token, { name: cfg.repoName, description: "dsh-sync-manager backup (插件与技能清单+快照)", isPrivate: cfg.isPrivate, ownerHint: owner });
  const remote = await repoFileMap(token, { owner, repo: cfg.repoName, branch: cfg.branch });
  const plan = buildPushPlan(local, remote);
  let created = 0, updated = 0, deleted = 0;
  for (const item of plan.toUpload) {
    const f = local.get(item.path);
    await putRepoFile(token, { owner, repo: cfg.repoName, path: item.path, content: f.content, branch: cfg.branch, message: `sync-manager: ${item.action} ${item.path}` });
    if (item.action === "create") created++; else updated++;
  }
  for (const path of plan.toDelete) {
    await deleteRepoFile(token, { owner, repo: cfg.repoName, path, branch: cfg.branch, message: `sync-manager: remove ${path}` });
    deleted++;
  }
  return { owner, repo: cfg.repoName, branch: cfg.branch, created, updated, deleted, unchanged: plan.unchanged.length };
}

function profilePath() { return profileDir(dshHome(), "web"); }

// ---------- /sync/api gateway ----------
function registerGateway(ctx, cfg) {
  ctx.effect?.(() => {
    const webServer = ctx.get?.("webServer");
    if (!webServer || typeof webServer.register !== "function") return;
    return webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: async (reqRaw, resRaw) => {
        const req = reqRaw;
        const res = resRaw;
        if (req.method !== "POST") { writeJson(res, 405, err("method-not-allowed", "POST only")); return; }
        if (!sanitizeOriginCheck(req, res)) { writeJson(res, 403, err("origin-not-allowed", "same-origin only")); return; }
        const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
        const method = pathname.startsWith(`${API_PREFIX}/`) ? pathname.slice(`${API_PREFIX}/`.length) : undefined;
        if (!method || method.includes("/")) { writeJson(res, 404, err("not-found", "unknown method")); return; }
        try {
          const body = await readJsonBody(req);
          const c = cfg();
          switch (method) {
            case "status": {
              const token = await resolveToken(ctx, c.tokenEnv);
              writeJson(res, 200, ok({
                home: dshHome(), tokenEnv: c.tokenEnv, tokenConfigured: !!token,
                repo: { owner: c.repoOwner || "(auto)", repoName: c.repoName, branch: c.branch },
                isPrivate: c.isPrivate, askOnChange: c.askOnChange,
              }));
              break;
            }
            case "token-status": {
              const token = await resolveToken(ctx, c.tokenEnv);
              writeJson(res, 200, ok({
                tokenEnv: c.tokenEnv, configured: !!token,
                source: token ? (process.env[c.tokenEnv] ? "env" : "credentials") : "none",
              }));
              break;
            }
            case "token-set": {
              const value = typeof body.value === "string" && body.value.length ? body.value.trim() : null;
              if (!value) { writeJson(res, 400, err("bad-request", "value required")); return; }
              const creds = ctx.get?.("credentials");
              if (creds?.set) await creds.set(credentialRef(c.tokenEnv), value);
              else process.env[c.tokenEnv] = value;
              writeJson(res, 200, ok({ tokenEnv: c.tokenEnv, configured: true }));
              break;
            }
            case "snapshot": {
              const snap = buildSnapshot();
              const local = gatherLocalFiles(snap);
              writeJson(res, 200, ok({
                generatedAt: snap.generatedAt,
                plugins: snap.profile.plugins.map((p) => ({ name: p.name, installed: p.installed, repository: p.repository, homepage: p.homepage })),
                bundles: snap.profile.bundles,
                presets: snap.presets.items.map((p) => ({ name: p.name, displayName: p.displayName, mounts: p.localPluginMounts })),
                skills: snap.skills.items.map((s) => ({ name: s.name, sourceUrl: s.sourceUrl })),
                envRefs: snap.envRefs,
                repoFileCount: local.size,
              }));
              break;
            }
            case "push": {
              const token = await resolveToken(ctx, c.tokenEnv);
              if (!token) throw new ApiError(400, "no-token", `未配置凭据 ${c.tokenEnv}（在 GUI 粘贴 PAT 或写入 .credentials.yaml refs）`);
              writeJson(res, 200, ok(await pushAll(token, c)));
              break;
            }
            case "diff": {
              const token = await resolveToken(ctx, c.tokenEnv);
              if (!token) throw new ApiError(400, "no-token", `未配置凭据 ${c.tokenEnv}`);
              const owner = await resolveOwner(token, c);
              const snap = buildSnapshot();
              const local = gatherLocalFiles(snap);
              const remote = await repoFileMap(token, { owner, repo: c.repoName, branch: c.branch });
              const plan = buildPushPlan(local, remote);
              writeJson(res, 200, ok({
                owner, repo: c.repoName,
                created: plan.toUpload.filter((i) => i.action === "create").length,
                updated: plan.toUpload.filter((i) => i.action === "update").length,
                deleted: plan.toDelete.length,
                unchanged: plan.unchanged.length,
                samples: plan.toUpload.slice(0, 8).map((i) => i.path),
              }));
              break;
            }
            case "install": {
              const spec = body.spec, sync = !!body.sync;
              if (typeof spec !== "string" || !SPEC_RE.test(spec)) throw new ApiError(400, "bad-request", "非法的安装规格");
              let token = null;
              if (sync) {
                token = await resolveToken(ctx, c.tokenEnv);
                if (!token) throw new ApiError(400, "no-token", `已请求安装后同步，但未配置凭据 ${c.tokenEnv}`);
              }
              const r = await installPlugin(profilePath(), spec);
              if (!r.ok) throw new ApiError(500, "pnpm-failed", r.error || "pnpm add 失败");
              const out = { install: { addedBundles: r.addedBundles, bundles: r.bundles }, note: "host 半已就位：client 刷新即生效；host 逻辑下次重启后生效" };
              if (sync) out.sync = await pushAll(token, c);
              writeJson(res, 200, ok(out));
              break;
            }
            case "remove": {
              const nm = body.name, sync = !!body.sync;
              if (typeof nm !== "string" || !NAME_RE.test(nm)) throw new ApiError(400, "bad-request", "非法的插件名");
              let token = null;
              if (sync) {
                token = await resolveToken(ctx, c.tokenEnv);
                if (!token) throw new ApiError(400, "no-token", `已请求删除后同步，但未配置凭据 ${c.tokenEnv}`);
              }
              const r = await removePlugin(profilePath(), nm);
              if (!r.ok) throw new ApiError(500, "pnpm-failed", r.error || "pnpm remove 失败");
              const out = { remove: { name: nm, bundles: r.bundles } };
              if (sync) out.sync = await pushAll(token, c);
              writeJson(res, 200, ok(out));
              break;
            }
            case "restore-preview":
            case "restore": {
              const token = await resolveToken(ctx, c.tokenEnv);
              if (!token) throw new ApiError(400, "no-token", `未配置凭据 ${c.tokenEnv}`);
              const owner = await resolveOwner(token, c);
              const pulled = await pullRepoToTemp({ token, owner, repo: c.repoName, branch: c.branch });
              if (!pulled.dir) throw new ApiError(404, "empty-repo", pulled.error || "仓库为空");
              try {
                const plan = buildRestorePlan(pulled.dir);
                if (method === "restore-preview") {
                  writeJson(res, 200, ok({
                    ops: plan.ops.map((op) => ({ kind: op.kind, name: op.name || op.preset || op.id || "", count: op.count || 0, reason: op.reason || null })),
                    dryRun: true,
                  }));
                } else {
                  const out = await applyRestorePlan(plan, pulled.dir);
                  if (!out.ok) throw new ApiError(500, "restore-failed", out.note || "还原失败");
                  writeJson(res, 200, ok({ applied: out.applied, missingEnv: out.missingEnv, note: out.note }));
                }
              } finally {
                rmTemp(pulled.dir);
              }
              break;
            }
            case "update-check":
            case "update": {
              const token = await resolveToken(ctx, c.tokenEnv);
              if (!token) throw new ApiError(400, "no-token", `未配置凭据 ${c.tokenEnv}`);
              const owner = await resolveOwner(token, c);
              const pulled = await pullRepoToTemp({ token, owner, repo: c.repoName, branch: c.branch });
              if (!pulled.dir) throw new ApiError(404, "empty-repo", pulled.error || "仓库为空");
              try {
                const plan = buildRestorePlan(pulled.dir);
                const toUpdate = plan.ops.filter((op) => op.kind === "npm-install");
                const changed = toUpdate.map((op) => ({ name: op.name, reason: op.reason, spec: op.spec }));
                if (method === "update-check") {
                  writeJson(res, 200, ok({ changed, none: changed.length === 0 }));
                } else {
                  const applied = [];
                  for (const op of toUpdate) {
                    const r = await installPlugin(profilePath(), op.spec);
                    if (!r.ok) throw new ApiError(500, "pnpm-failed", `${op.name}: ${r.error}`);
                    applied.push(op.name);
                  }
                  writeJson(res, 200, ok({ applied, none: applied.length === 0, note: "若 host 平面插件更新，重启 dsh web 后生效" }));
                }
              } finally {
                rmTemp(pulled.dir);
              }
              break;
            }
            default:
              writeJson(res, 404, err("not-found", `unknown method "${method}"`));
          }
        } catch (e) {
          if (e instanceof ApiError) { writeJson(res, e.status, err(e.code, e.message)); return; }
          const message = e instanceof Error ? e.message : String(e);
          writeJson(res, 500, err("internal", message));
        }
      },
    });
  }, "sync-manager: /sync/api routes");
}

// ---------- plugin apply ----------
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULT_CFG, ...config };
  ctx.inject?.(["settings"], (sctx) => {
    sctx.settings.register(NS, Config, { base: cfg });
  });
  registerGateway(ctx, () => cfg);
}
