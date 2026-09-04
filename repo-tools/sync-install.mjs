#!/usr/bin/env node
// 把工作区源码同步到 profile 的 node_modules/dsh-sync-manager（真实目录，供 Loader 解析）。
// 适用：开发迭代后刷新（host 改动仍需重启 dsh web；client 刷新页面即可）。
// 用法：node repo-tools/sync-install.mjs [--home C:/Users/x/.dsh] [--profile web]
import { parseArgs } from "node:util";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";

const { values: v } = parseArgs({
  options: {
    home: { type: "string", default: process.env.DSH_HOME || join(homedir(), ".dsh") },
    profile: { type: "string", default: "web" },
  },
});

const here = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"); // windows path
const srcDir = join(dirname(resolve(process.argv[1])), ".."); // 以脚本自身路径推导包根，避免目录解析歧义
const pjPath = join(srcDir, "package.json");
if (!existsSync(pjPath)) { console.error("未找到源码 package.json at " + srcDir); process.exit(1); }
const dstDir = join(v.home, "profiles", v.profile, "node_modules", "dsh-sync-manager");
// 若 dest 是 junction/符号链接且指向 src（pnpm link/file 场景），先拆除再建真实目录
if (existsSync(dstDir)) {
  const rp = (p) => { try { return realpathSync(p); } catch { return p; } };
  if (rp(dstDir) === rp(srcDir)) {
    console.log("dest 是指向 src 的链接，拆除后重建真实目录");
    rmSync(dstDir, { recursive: true, force: true });
  }
}
mkdirSync(dstDir, { recursive: true });
for (const item of ["package.json", "cordis.patch.yml", "README.md"]) cpSync(join(srcDir, item), join(dstDir, item));
for (const item of ["lib", "core"]) {
  rmSync(join(dstDir, item), { recursive: true, force: true });
  cpSync(join(srcDir, item), join(dstDir, item), { recursive: true });
}
// 确保 bundles 包含 dsh-sync-manager
const profilePjPath = join(v.home, "profiles", v.profile, "package.json");
if (existsSync(profilePjPath)) {
  const raw = readFileSync(profilePjPath, "utf8");
  const pj = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  const bundles = pj.dsh?.profile?.bundles || [];
  if (!bundles.includes("dsh-sync-manager")) {
    pj.dsh = { ...(pj.dsh || {}), profile: { ...(pj.dsh?.profile || {}), bundles: [...bundles, "dsh-sync-manager"] } };
    writeFileSync(profilePjPath, JSON.stringify(pj, null, 2), "utf8");
    console.log("bundles 已追加 dsh-sync-manager");
  }
}
console.log(`synced -> ${dstDir}`);
console.log("host 改动生效需重启 dsh web；client 改动刷新页面即可。");
