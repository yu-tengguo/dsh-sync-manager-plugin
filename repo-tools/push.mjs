#!/usr/bin/env node
// 真实推送：把本机快照同步到 GitHub 备份仓（REST contents API）。
// token 来源优先级：GITHUB_TOKEN 环境变量 > ~/.dsh/.credentials.yaml 的 GITHUB_SYNC_TOKEN ref。
// token 仅在此进程内使用，绝不打印、绝不写入任何输出/文件。
// 用法：node repo-tools/push.mjs [--owner yu-tengguo] [--repo dsh-sync-manager] [--private]
import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildSnapshot } from "../core/src/scanner.mjs";
import { gatherLocalFiles, buildPushPlan } from "../core/src/plan.mjs";
import { scanText } from "../core/src/secret-scan.mjs";
import { ensureRepo, gh, putRepoFile, deleteRepoFile, repoFileMap, listRepoTree, readRepoFile } from "../core/src/github.mjs";
import { buildRestorePlan } from "../core/src/restore.mjs";

const { values: v } = parseArgs({
  options: {
    owner: { type: "string", default: "" },
    repo: { type: "string", default: "dsh-sync-manager" },
    branch: { type: "string", default: "main" },
    private: { type: "boolean", default: true },
    "dry-run": { type: "boolean", default: false },
  },
});

function readCredsRef(name) {
  const f = join(process.env.DSH_HOME || join(homedir(), ".dsh"), ".credentials.yaml");
  if (!existsSync(f)) return null;
  const raw = readFileSync(f, "utf8");
  const m = raw.match(new RegExp(`^\\s{2}${name}:\\s*(.+)\\s*$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || readCredsRef("GITHUB_SYNC_TOKEN");
  if (!token) throw new Error("未找到 GITHUB_TOKEN env 或 .credentials.yaml 的 GITHUB_SYNC_TOKEN ref");
  const me = await gh(token, "GET", "/user");
  const owner = v.owner || me.json?.login;
  if (!owner) throw new Error("无法确定 GitHub 用户名");
  console.log(`[push] 用户: ${owner}  仓库: ${v.repo}@${v.branch}  私有: ${v.private}`);

  const snap = buildSnapshot();
  const local = gatherLocalFiles(snap);
  console.log(`[push] 本地快照: ${snap.profile.plugins.length} 插件 / ${snap.presets.items.length} 预置 / ${snap.skills.items.length} skills / ${local.size} 个仓库文件`);

  // 安全闸：逐文件密钥扫描（模板文档中的占位示例放行；任何疑似真实密钥 → 整批拒绝）
  const real = [];
  let placeholderNotes = 0;
  for (const [path, f] of local) {
    for (const hit of scanText(f.content, path)) {
      if (hit.placeholder) { placeholderNotes++; continue; }
      real.push(hit);
      if (real.length > 20) break;
    }
    if (real.length > 20) break;
  }
  if (real.length) throw new Error(`密钥扫描未通过（${real.length} 处真实疑似，样例 ${real[0].sample} @ ${real[0].source}）— 已中止，绝不入库`);
  if (placeholderNotes) console.log(`[push] 已放行 ${placeholderNotes} 处模板占位示例（非真实密钥）`);

  if (v["dry-run"]) {
    console.log("[push] dry-run：扫描通过，未上传");
    return;
  }
  const repoInfo = await ensureRepo(token, { name: v.repo, description: "dsh-sync-manager backup (插件与技能清单+快照)", isPrivate: v.private, ownerHint: owner });
  const remote = await repoFileMap(token, { owner, repo: v.repo, branch: v.branch });
  const plan = buildPushPlan(local, remote);
  console.log(`[push] 计划: 创建 ${plan.toUpload.filter((i) => i.action === "create").length} / 更新 ${plan.toUpload.filter((i) => i.action === "update").length} / 删除 ${plan.toDelete.length} / 未变 ${plan.unchanged.length}`);
  let created = 0, updated = 0, deleted = 0;
  for (const item of plan.toUpload) {
    const f = local.get(item.path);
    await putRepoFile(token, { owner, repo: v.repo, path: item.path, content: f.content, branch: v.branch, message: `sync-manager: ${item.action} ${item.path}` });
    if (item.action === "create") created++; else updated++;
  }
  for (const path of plan.toDelete) {
    await deleteRepoFile(token, { owner, repo: v.repo, path, branch: v.branch, message: `sync-manager: remove ${path}` });
    deleted++;
  }
  console.log(`[push] 完成: created=${created} updated=${updated} deleted=${deleted}`);
  const tree = await listRepoTree(token, { owner, repo: v.repo, branch: v.branch });
  console.log(`[push] 远端文件数: ${tree.length}`);

  // 远端还原计划自检（本机应 up-to-date）
  const catalog = await readRepoFile(token, { owner, repo: v.repo, path: "catalog.json", branch: v.branch });
  if (catalog) {
    const { tmpdir } = await import("node:os");
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs");
    const { join: jp } = await import("node:path");
    const dir = mkdtempSync(jp(tmpdir(), "dsm-pull-"));
    mkdirSync(jp(dir, "presets"), { recursive: true });
    const w = (p, t) => { mkdirSync(jp(dir, ...p.split("/").slice(0, -1)), { recursive: true }); writeFileSync(jp(dir, ...p.split("/")), t, "utf8"); };
    w("catalog.json", catalog.text);
    for (const t of tree.filter((t) => t.path.startsWith("presets/") || t.path.startsWith("skills/"))) {
      const got = await readRepoFile(token, { owner, repo: v.repo, path: t.path, branch: v.branch });
      if (got) w(t.path, got.text);
    }
    const plan2 = buildRestorePlan(dir);
    console.log(`[push] 远端还原计划自检: ${plan2.ops.length} 步（npm=${plan2.ops.filter((o) => o.kind === "npm-install").length}, presets=${plan2.ops.filter((o) => o.kind === "write-preset").length}, skills=${plan2.ops.filter((o) => o.kind === "write-skills").length}, env=${plan2.ops.filter((o) => o.kind === "check-env").length}）`);
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("[push] 失败: " + (e instanceof Error ? e.message : e)); process.exit(1); });
