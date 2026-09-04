// Restore planner: given (a) a local directory that mirrors the backup repo
// (or the catalog.json + presets/... tree), and (b) current machine state,
// produce an ordered, idempotent operation plan. --dry-run prints, never writes.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scanNpmPlugins, scanPresets, dshHome } from "./scanner.mjs";

function walk(root, base = "") {
  const out = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, rel));
    else out.push({ path: rel, size: st.size });
  }
  return out;
}

/**
 * repoRoot: local checkout of the backup repo (must contain catalog.json and presets/).
 * Returns { catalog, ops, warnings } where ops are ordered steps with {kind, ...}.
 */
export function buildRestorePlan(repoRoot, { home = dshHome(), dryRun = true } = {}) {
  const catalogPath = join(repoRoot, "catalog.json");
  if (!existsSync(catalogPath)) throw new Error(`no catalog.json in ${repoRoot}`);
  let raw = readFileSync(catalogPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 剥离 UTF-8 BOM
  const catalog = JSON.parse(raw);
  const ops = [];
  const warnings = [];
  const machine = scanNpmPlugins("web", home);

  // 1) npm bundle plugins（内置 dsh-install-dir 来源跳过：来自 dsh 安装闭包，不需也不应 npm 重装）
  for (const p of catalog.profile.plugins) {
    if (p.sourceKind === "dsh-install-dir") continue;
    const inst = machine.plugins.find((m) => m.name === p.name);
    if (!inst || !inst.installed) {
      const spec = p.name + (p.declared ? `@${p.declared.replace(/^[\^~]/, "")}` : "");
      ops.push({ kind: "npm-install", name: p.name, spec, reason: inst ? "not-installed" : "not-installed" });
    } else if (inst.installed !== p.installed && p.installed) {
      ops.push({ kind: "npm-install", name: p.name, spec: `${p.name}@${p.installed}`, reason: `version ${inst.installed} -> ${p.installed}` });
    }
  }
  // 2) ensure bundles list in profile package.json
  const missingBundles = (catalog.profile.bundles || []).filter((b) => !machine.bundles.includes(b));
  if (missingBundles.length) ops.push({ kind: "patch-bundles", add: missingBundles, bundles: catalog.profile.bundles });

  // 3) presets dirs (files under repoRoot/presets/<name>/...)
  const presetSrc = join(repoRoot, "presets");
  if (existsSync(presetSrc)) {
    for (const name of readdirSync(presetSrc)) {
      const dir = join(presetSrc, name);
      if (!statSync(dir).isDirectory()) continue;
      const files = walk(dir);
      ops.push({ kind: "write-preset", preset: name, files: files.map((f) => f.path), count: files.length });
    }
  }

  // 4) env names that must exist on this machine (informational gate)
  if (catalog.envRefs?.length) {
    ops.push({ kind: "check-env", names: catalog.envRefs.filter((n) => !process.env[n]), note: "这些环境变量在本机未设置（仅名字，值请自行提供）" });
  }

  // 5) skills (files under repoRoot/skills/<name>/... -> agentsHome/skills/<name>/...)
  const skillSrc = join(repoRoot, "skills");
  if (existsSync(skillSrc)) {
    for (const name of readdirSync(skillSrc)) {
      const dir = join(skillSrc, name);
      if (!statSync(dir).isDirectory()) continue;
      const files = walk(dir);
      ops.push({ kind: "write-skills", id: name, files: files.map((f) => f.path), count: files.length });
    }
  }

  return { catalog, ops, warnings, dryRun };
}
