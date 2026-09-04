// dsh-sync-manager core CLI (standalone, zero deps).
//   node cli.mjs snapshot [-o out.json]      inventory this machine
//   node cli.mjs scan <path> [path...]       secret-scan files/dirs
//   node cli.mjs manifest <snapshot.json>    show uploadable file list
// GUI/host plugin later reuses the same core functions.

import { writeFileSync, readFileSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { buildSnapshot } from "./src/scanner.mjs";
import { scanAllTextFiles, scanFile } from "./src/secret-scan.mjs";
import { buildRestorePlan } from "./src/restore.mjs";
import { gatherLocalFiles } from "./src/plan.mjs";

const [cmd, ...args] = process.argv.slice(2);

function main() {
  if (cmd === "snapshot") {
    const snap = buildSnapshot();
    const outIdx = args.indexOf("-o");
    if (outIdx >= 0 && args[outIdx + 1]) {
      writeFileSync(args[outIdx + 1], JSON.stringify(snap, null, 2), "utf8");
      console.log(`snapshot written: ${args[outIdx + 1]}`);
    } else {
      console.log(JSON.stringify(snap, null, 2));
    }
    console.log(`summary: ${snap.profile.plugins.length} npm plugins, ${snap.presets.items.length} presets, ${snap.envRefs.length} env-name refs`);
    return;
  }
  if (cmd === "scan") {
    if (args.length === 0) { console.error("usage: node cli.mjs scan <path>..."); process.exit(1); }
    let findings = [];
    for (const p of args) {
      const st = statSync(p);
      if (st.isDirectory()) findings.push(...scanAllTextFiles(p));
      else findings.push(...scanFile(p));
    }
    if (findings.length === 0) { console.log("OK: no secret-like content found"); return; }
    for (const f of findings) console.log(`[${f.rule}] ${f.source} @${f.at} sample=${f.sample}`);
    process.exit(2);
  }
  if (cmd === "manifest") {
    const snap = JSON.parse(readFileSync(args[0], "utf8"));
    const files = [];
    for (const p of snap.presets.items) for (const f of p.files) files.push({ path: `presets/${p.name}/${f.path}`, size: f.size });
    console.log(JSON.stringify({ presetsFiles: files.length, presets: files.map((f) => f.path), skills: snap.skills }, null, 2));
    return;
  }
  if (cmd === "export-repo") {
    const [snapFile, outDir] = args;
    if (!snapFile || !outDir) { console.error("usage: node cli.mjs export-repo <snapshot.json> <outDir>"); process.exit(1); }
    const snap = JSON.parse(readFileSync(snapFile, "utf8").replace(/^\uFEFF/, ""));
    // 与 push 网关共用同一目录聚合（catalog 格式、白名单过滤、密钥排除都唯一）
    const map = gatherLocalFiles(snap);
    mkdirSync(outDir, { recursive: true });
    let n = 0;
    for (const [rel, f] of map) {
      const dst = join(outDir, ...rel.split("/"));
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, f.content, "utf8");
      n++;
    }
    console.log(`exported to ${outDir}: ${n} files (catalog.json + README.md + presets/ + skills/)`);
    return;
  }
  if (cmd === "restore-plan") {
    const repoRoot = args[0];
    const plan = buildRestorePlan(repoRoot);
    console.log(`restore plan for repo: ${repoRoot} (dryRun=${plan.dryRun})`);
    for (const op of plan.ops) {
      if (op.kind === "npm-install") console.log(`  [npm-install] ${op.name}  (${op.spec})  reason=${op.reason}`);
      else if (op.kind === "patch-bundles") console.log(`  [patch-bundles] add ${op.add.join(", ")}`);
      else if (op.kind === "write-preset") console.log(`  [write-preset] ${op.preset} (${op.count} files)`);
      else if (op.kind === "check-env") console.log(`  [check-env] missing: ${op.names.join(", ") || "(none)"} — ${op.note}`);
      else if (op.kind === "write-skills") console.log(`  [write-skills] ${op.id} (${op.count} files)`);
      else console.log(`  [${op.kind}] ${JSON.stringify(op)}`);
    }
    if (!plan.ops.length) console.log("  (nothing to do — machine is up to date)");
    return;
  }
  console.error("unknown command: " + cmd);
  console.error("usage: node cli.mjs {snapshot|scan|export-repo|restore-plan}");
  process.exit(1);
}

main();
