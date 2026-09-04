// dsh-sync-manager — host operation layer: pnpm 安装/卸载、bundles 对账、
// 远程仓库拉取到临时目录、还原执行（写预置/skills 文件、跑 pnpm）。
// 仅供 host 半（lib/index.js 的 /sync/api 网关）调用。

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { profileDir, dshHome } from "../core/src/scanner.mjs";
import { listRepoTree, readRepoFile } from "../core/src/github.mjs";

// ---------- pnpm ----------
export function runPnpm(profile, args) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn("pnpm", args, {
        cwd: profile,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ code: -1, out: String(e) });
      return;
    }
    child.stdout?.on("data", (d) => { out += d; });
    child.stderr?.on("data", (d) => { out += d; });
    child.on("error", (e) => resolve({ code: -1, out: String(e) }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

// ---------- profile / bundles ----------
function readPj(profile) {
  return JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
}
function writePj(profile, pj) {
  writeFileSync(join(profile, "package.json"), JSON.stringify(pj, null, 2), "utf8");
}
function bundlesOf(pj) {
  return pj.dsh?.profile?.bundles || [];
}
function pkgManifestPath(profile, name) {
  if (name.startsWith("@")) {
    const [s, n] = name.split("/");
    return join(profile, "node_modules", s, n, "package.json");
  }
  return join(profile, "node_modules", name, "package.json");
}
export function hasBundleDecl(profile, name) {
  const p = pkgManifestPath(profile, name);
  if (!existsSync(p)) return false;
  try {
    const meta = JSON.parse(readFileSync(p, "utf8"));
    return !!(meta.dsh?.bundle?.patch);
  } catch { return false; }
}
export function ensureBundles(profile, names) {
  const pj = readPj(profile);
  const bundles = bundlesOf(pj);
  let changed = false;
  for (const n of names) {
    if (!bundles.includes(n)) { bundles.push(n); changed = true; }
  }
  if (changed) {
    pj.dsh = { ...(pj.dsh || {}), profile: { ...(pj.dsh?.profile || {}), bundles } };
    writePj(profile, pj);
  }
  return { bundles, changed };
}
export function removeFromBundles(profile, name) {
  const pj = readPj(profile);
  const bundles = bundlesOf(pj).filter((b) => b !== name);
  if (bundles.length !== bundlesOf(pj).length) {
    pj.dsh = { ...(pj.dsh || {}), profile: { ...(pj.dsh?.profile || {}), bundles } };
    writePj(profile, pj);
  }
  return { bundles };
}

// ---------- 安装 / 卸载（spawn pnpm，执行后 reconcile bundles） ----------
export const SPEC_RE = /^[^\s-][A-Za-z0-9@.:_~+\/=#-]{0,299}$/;
export const NAME_RE = /^(@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

function pnpmResolved(r) {
  // pnpm 在 build 脚本被策略忽略时以退出码 1 返回 ERR_PNPM_IGNORED_BUILDS，
  // 但依赖本身已正确安装——按"已解析"处理（原生模块可之后 approve-builds）。
  return r.code === 0 || (r.code === 1 && /ERR_PNPM_IGNORED_BUILDS/.test(r.out || ""));
}

export async function installPlugin(profile, spec) {
  if (typeof spec !== "string" || !SPEC_RE.test(spec)) return { ok: false, error: "非法的插件安装规格" };
  const r = await runPnpm(profile, ["add", spec]);
  if (!pnpmResolved(r)) return { ok: false, error: r.out.slice(-800) || `pnpm 退出码 ${r.code}` };
  // reconcile：把所有声明了 dsh.bundle 的新增依赖追加进 bundles（与 dsh plugin 一致）
  const pj = readPj(profile);
  const bundles = bundlesOf(pj);
  let addedBundles = [];
  for (const name of Object.keys(pj.dependencies || {})) {
    if (!bundles.includes(name) && hasBundleDecl(profile, name)) {
      bundles.push(name);
      addedBundles.push(name);
    }
  }
  if (addedBundles.length) {
    pj.dsh = { ...(pj.dsh || {}), profile: { ...(pj.dsh?.profile || {}), bundles } };
    writePj(profile, pj);
  }
  return { ok: true, addedBundles, bundles };
}

export async function removePlugin(profile, name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, error: "非法的插件名" };
  const r = await runPnpm(profile, ["remove", name]);
  const bundles = removeFromBundles(profile, name).bundles;
  if (r.code !== 0) return { ok: false, error: r.out.slice(-800) || `pnpm 退出码 ${r.code}` };
  return { ok: true, bundles };
}

// ---------- 远程仓库拉取到临时目录 ----------
const ALLOWED_REPO_PREFIX = ["catalog.json", "README.md", "presets/", "skills/"];
export async function pullRepoToTemp({ token, owner, repo, branch }) {
  const tree = await listRepoTree(token, { owner, repo, branch });
  const wanted = tree.filter((t) =>
    t.path === "catalog.json" || t.path === "README.md" ||
    t.path.startsWith("presets/") || t.path.startsWith("skills/"));
  if (!wanted.length) return { dir: null, count: 0, error: "仓库中没有可还原内容（缺 catalog.json）" };
  const dir = join(tmpdir(), `dsh-sync-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  let count = 0;
  for (const t of wanted) {
    const got = await readRepoFile(token, { owner, repo, path: t.path, branch });
    if (!got) continue;
    const full = join(dir, ...t.path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, got.text, "utf8");
    count++;
  }
  return { dir, count };
}

export function rmTemp(dir) {
  if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
}

// ---------- 还原执行 ----------
export function copyTree(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const s = join(srcDir, name);
    const d = join(dstDir, name);
    if (statSync(s).isDirectory()) copyTree(s, d);
    else copyFileSync(s, d);
  }
}

/**
 * 按 plan.ops 顺序执行还原。repoRoot 指向已拉取的仓库目录（含 presets/、skills/）。
 * @returns {{ ok, applied: string[], missingEnv: string[], note: string }}
 */
export async function applyRestorePlan(plan, repoRoot, { home = dshHome(), agentsHome = null } = {}) {
  const applied = [];
  const missingEnv = [];
  const ah = agentsHome || process.env.DSH_AGENTS_HOME || join(homedir(), ".agents");
  const profile = profileDir(home, "web");
  const presetRoot = join(home, ".agent-presets");
  for (const op of plan.ops) {
    if (op.kind === "npm-install") {
      const r = await runPnpm(profile, ["add", op.spec]);
      if (!pnpmResolved(r)) return { ok: false, applied, missingEnv, note: `pnpm add ${op.spec} 失败：${r.out.slice(-500)}` };
      // 包确实落盘才算成功（即便只是 build 被跳过）
      if (!existsSync(pkgManifestPath(profile, op.name))) {
        return { ok: false, applied, missingEnv, note: `pnpm add ${op.spec} 未落盘 ${op.name}` };
      }
      if (hasBundleDecl(profile, op.name)) ensureBundles(profile, [op.name]);
      applied.push(`npm-install ${op.name}`);
    } else if (op.kind === "patch-bundles") {
      ensureBundles(profile, op.bundles);
      applied.push(`bundles 补齐 (${op.bundles.join(", ")})`);
    } else if (op.kind === "write-preset") {
      copyTree(join(repoRoot, "presets", op.preset), join(presetRoot, op.preset));
      applied.push(`write-preset ${op.preset}`);
    } else if (op.kind === "write-skills") {
      copyTree(join(repoRoot, "skills", op.id), join(ah, "skills", op.id));
      applied.push(`write-skills ${op.id}`);
    } else if (op.kind === "check-env") {
      for (const n of op.names) if (!process.env[n]) missingEnv.push(n);
    }
  }
  return { ok: true, applied, missingEnv, note: "npm/预置/skills 已就位；host 平面改动需重启 dsh web 生效（client 平面刷新即可）。" };
}
