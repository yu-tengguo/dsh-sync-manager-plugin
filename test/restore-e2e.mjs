// 新机器还原端到端模拟（离线、不动真机）：
// 用临时 fake DSH home（空 profile）扮演"全新安装的 DSH"，
// 以 test-fixture-repo 作为备份仓库，执行 buildRestorePlan -> applyRestorePlan，
// 断言：npm 用户插件被安装、内置 dsh-base 不被重装、bundles 补齐、预置/skills 写入。
// 运行：node test/restore-e2e.mjs   （会真实 pnpm add 两个插件到临时目录，需要 registry）
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildRestorePlan } from "../core/src/restore.mjs";
import { applyRestorePlan } from "../lib/hostops.mjs";

const repoRoot = resolve("test-fixture-repo");
const work = mkdtempSync(join(tmpdir(), "dsm-e2e-"));
const home = join(work, "home");
const profile = join(home, "profiles", "web");
const agentsHome = join(work, "agents");
mkdirSync(profile, { recursive: true });
mkdirSync(agentsHome, { recursive: true });
writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "web", private: true, version: "0.0.0" }, null, 2), "utf8");

let pass = 0, fail = 0;
const check = (l, c, x = "") => { c ? (pass++, console.log(`  ok: ${l}`)) : (fail++, console.error(`FAIL: ${l} ${x}`)); };

let plan;
try {
  plan = buildRestorePlan(repoRoot, { home });
} catch (e) { console.error("plan failed:", e.message); process.exit(1); }

const npm = plan.ops.filter((o) => o.kind === "npm-install").map((o) => o.name);
check("计划包含用户插件 dsh-better-sidebar", npm.includes("dsh-better-sidebar"));
check("计划包含用户插件 dsh-ego-browser", npm.includes("dsh-ego-browser"));
check("计划不重装内置 dsh-base/dsh-web-app", !npm.includes("@deepseek-ai/dsh-base") && !npm.includes("@deepseek-ai/dsh-web-app"), npm.join(","));
check("计划含预置写入", plan.ops.some((o) => o.kind === "write-preset"));
check("计划含 skills 写入", plan.ops.some((o) => o.kind === "write-skills"));
check("计划含 env 提示", plan.ops.some((o) => o.kind === "check-env"));

console.log("\n[apply] 执行还原（含真实 pnpm add）…");
const out = await applyRestorePlan(plan, repoRoot, { home, agentsHome });
console.log("applied:", out.applied.join(" | "));
console.log("missingEnv:", out.missingEnv.join(", "));
check("apply 成功", out.ok, out.note);

if (out.ok) {
  const pj = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
  check("依赖含 dsh-better-sidebar", !!pj.dependencies?.["dsh-better-sidebar"], JSON.stringify(pj.dependencies));
  check("依赖含 dsh-ego-browser", !!pj.dependencies?.["dsh-ego-browser"]);
  const bundles = pj.dsh?.profile?.bundles || [];
  check("bundles 补齐 4 个", bundles.length >= 4 && bundles.includes("dsh-better-sidebar") && bundles.includes("dsh-ego-browser") && bundles.includes("@deepseek-ai/dsh-base"), bundles.join(","));
  // 预置
  const presetDirs = readdirSync(join(home, ".agent-presets")).filter((n) => statSync(join(home, ".agent-presets", n)).isDirectory());
  check("写入预置数 = 8", presetDirs.length === 8, String(presetDirs.length));
  // skills（写入 agentsHome/skills/<id>/ 下）
  const skillRoot = join(agentsHome, "skills");
  const skillDirs = readdirSync(skillRoot).filter((n) => statSync(join(skillRoot, n)).isDirectory());
  check("写入 skills 数 = 5", skillDirs.length === 5, String(skillDirs.length) + " " + skillDirs.join(","));
}

rmSync(work, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
