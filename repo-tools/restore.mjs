#!/usr/bin/env node
// dsh-sync-manager — 新机/异机还原工具（纯 Node + core，无需 DSH 或 GUI）。
// 用法：
//   node repo-tools/restore.mjs --local <仓库本地目录>            # 从本地备份目录还原（测试/离线）
//   node repo-tools/restore.mjs --owner <用户名> [--repo dsh-sync-manager] [--branch main]
//                                                               # 经 GitHub REST 拉取备份仓后还原
//   GITHUB_TOKEN=ghp_... node repo-tools/restore.mjs ...         # token 只经环境变量传入，绝不写入/入库
//   --dry-run  只打印将要执行的操作，不落盘
//   --profile web
// 说明：还原目标 = $DSH_HOME（默认 ~/.dsh）的 .agent-presets 与 ~/.agents/skills，
// npm 插件以 pnpm add 装入 profile，bundles 自动补齐；env 名只提示不代填值。

import { parseArgs } from "node:util";
import { join } from "node:path";
import { buildRestorePlan } from "../core/src/restore.mjs";
import { dshHome } from "../core/src/scanner.mjs";
import { pullRepoToTemp, rmTemp, applyRestorePlan } from "../lib/hostops.mjs";

const {
  values: v,
} = parseArgs({
  options: {
    owner: { type: "string" },
    repo: { type: "string", default: "dsh-sync-manager" },
    branch: { type: "string", default: "main" },
    local: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    profile: { type: "string", default: "web" },
    "agents-home": { type: "string" },
  },
});

function fail(msg) { console.error(`[restore] 错误：${msg}`); process.exit(1); }

async function main() {
  const home = dshHome();
  console.log(`[restore] DSH home = ${home}, profile = ${v.profile}`);

  let root = null;
  let tempDir = null;
  if (v.local) {
    root = v.local;
    console.log(`[restore] 使用本地备份目录：${root}`);
  } else {
    if (!v.owner) fail("需 --owner <GitHub 用户名>（或使用 --local）");
    const token = process.env.GITHUB_TOKEN;
    if (!token) fail("未找到 GITHUB_TOKEN 环境变量（token 仅经环境变量传入，绝不入库）");
    console.log(`[restore] 经 GitHub REST 拉取 ${v.owner}/${v.repo}@${v.branch} …`);
    const pulled = await pullRepoToTemp({ token, owner: v.owner, repo: v.repo, branch: v.branch });
    if (!pulled.dir) fail(pulled.error || "仓库中没有可还原内容");
    tempDir = pulled.dir;
    root = pulled.dir;
    console.log(`[restore] 已拉取 ${pulled.count} 个文件`);
  }

  const plan = buildRestorePlan(root, { home });
  console.log(`\n[restore] 计划（${plan.ops.length} 步）：`);
  for (const op of plan.ops) {
    const label =
      op.kind === "npm-install" ? `npm 安装 ${op.name}${op.reason ? `  (${op.reason})` : ""}`
      : op.kind === "patch-bundles" ? `补齐 bundles：${(op.bundles || []).join(", ")}`
      : op.kind === "write-preset" ? `写入预置 ${op.preset}（${op.count ?? op.files?.length ?? "?"} 个文件）`
      : op.kind === "write-skills" ? `写入 skill ${op.id}（${op.count ?? op.files?.length ?? "?"} 个文件）`
      : op.kind === "check-env" ? `提示环境变量：${(op.names || []).join(", ")}`
      : op.kind;
    console.log(`  - ${label}`);
  }
  for (const w of plan.warnings) console.warn(`  ! ${w}`);

  if (v["dry-run"]) { console.log("\n[restore] dry-run：未做任何改动"); rmTemp(tempDir); return; }

  console.log("\n[restore] 执行中 …");
  const out = await applyRestorePlan(plan, root, { home, agentsHome: v["agents-home"] || undefined });
  rmTemp(tempDir);
  if (!out.ok) fail(out.note || "还原失败");
  console.log(`[restore] 完成：\n  ${out.applied.join("\n  ")}`);
  if (out.missingEnv.length) {
    console.log(`\n[restore] 以下环境变量/凭据名在本机未设置（值请自行提供，绝不代填）：\n  ${out.missingEnv.join(", ")}`);
  }
  console.log(out.note || "");
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
