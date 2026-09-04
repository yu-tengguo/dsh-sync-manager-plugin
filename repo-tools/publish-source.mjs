#!/usr/bin/env node
// 把插件源码发布到 GitHub 仓库根目录（公共仓存插件本体；私有备份仓则与 catalog/presets/skills 共存）。
// 新机器：dsh plugin add github:<owner>/<repo> 装管家 → GUI 一键还原数据。
// token：env GITHUB_TOKEN > .credentials.yaml GITHUB_SYNC_TOKEN（不发命令行）。
// 用法：node repo-tools/publish-source.mjs [--owner yu-tengguo] [--repo dsh-sync-manager-plugin] [--public]
import { parseArgs } from "node:util";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { blobSha } from "../core/src/plan.mjs";
import { gh, ensureRepo, repoFileMap, putRepoFile } from "../core/src/github.mjs";

const { values: v } = parseArgs({
  options: {
    owner: { type: "string", default: "" },
    repo: { type: "string", default: "dsh-sync-manager-plugin" },
    branch: { type: "string", default: "main" },
    public: { type: "boolean", default: false },
  },
});

function readCredsRef(name) {
  const f = join(process.env.DSH_HOME || join(homedir(), ".dsh"), ".credentials.yaml");
  if (!existsSync(f)) return null;
  const m = readFileSync(f, "utf8").match(new RegExp(`^\\s{2}${name}:\\s*(.+)\\s*$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE = new Set([
  "node_modules", ".git", "test-fixture-repo", "out-check", ".e2e-snap.json",
  ".e2e-tmp", "sample-snapshot.json", "sample-snapshot2.json",
]);
const IGNORE_RE = /(^|\/)(\.DS_Store|Thumbs\.db|.*\.log)$/i;
const BINARY_RE = /\.(png|jpe?g|gif|webp|ico|pdf|zip|7z|gz|jar|exe|dll|node|db|sqlite|wasm|woff2?|mp4|webm)$/i;

function walk(dir, base = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name) || IGNORE_RE.test(name)) continue;
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, size: st.size });
  }
  return out;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || readCredsRef("GITHUB_SYNC_TOKEN");
  if (!token) throw new Error("无 token（env GITHUB_TOKEN 或 .credentials.yaml 的 GITHUB_SYNC_TOKEN）");
  const me = await gh(token, "GET", "/user");
  const owner = v.owner || me.json?.login;
  const info = await ensureRepo(token, {
    name: v.repo,
    description: "dsh-sync-manager 插件本体（插件与技能管家 / DSH plugin: plugins & skills manager）",
    isPrivate: !v.public,
    ownerHint: owner,
  });
  console.log(`[publish-source] ${owner}/${v.repo}@${v.branch}  ${v.public ? "public" : "private"}  ${info?.html_url || ""}`);

  const files = walk(ROOT).filter((f) => f.size <= 2 * 1024 * 1024 && !BINARY_RE.test(f.rel));
  console.log(`[publish-source] 本地源码文本文件: ${files.length}`);
  const remote = await repoFileMap(token, { owner, repo: v.repo, branch: v.branch });
  let created = 0, updated = 0, skipped = 0;
  for (const f of files) {
    const content = readFileSync(join(ROOT, ...f.rel.split("/")), "utf8");
    if (content.charCodeAt(0) === 0xfeff && !f.rel.endsWith(".yaml") && !f.rel.endsWith(".yml")) continue; // BOM 文本按原样也行，跳过 YAML 类以外没必要
    const sha = blobSha(content);
    const r = remote.get(f.rel);
    if (r && r.sha === sha) { skipped++; continue; }
    await putRepoFile(token, { owner, repo: v.repo, path: f.rel, content, branch: v.branch, message: `publish-source: ${r ? "update" : "create"} ${f.rel}` });
    if (r) updated++; else created++;
  }
  console.log(`[publish-source] 完成: created=${created} updated=${updated} unchanged(skip)=${skipped}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[publish-source] 失败: " + (e instanceof Error ? e.message : e)); process.exit(1); });
