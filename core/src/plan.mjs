// Diff engine: turn a local snapshot into concrete repo files (with git blob
// SHAs for change detection, same trick the existing browser-tool sync uses),
// and diff them against the remote tree map produced by github.mjs.

import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export function blobSha(content) {
  const buf = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

const BINARY_ISH = /\.(png|jpe?g|gif|webp|ico|pdf|zip|7z|gz|jar|node|db|sqlite|wasm|woff2?|mp4|webm)$/i;
// .env / .env.example / .env.local / credentials* / token* / secret*（含路径段词），一律不收集
const SECRET_FILE = /(^|\/)(\.env(\.|$)|[^/]*[._-]credentials[._-][^/]*|[^/]*[._-]token[._-][^/]*|[^/]*[._-]secret[._-][^/]*)/i;

function safeReadUtf8(file) {
  try {
    const st = statSync(file);
    if (st.size > 2 * 1024 * 1024) return null;
    if (BINARY_ISH.test(file)) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Collect every file the backup repo should contain, in-memory (path -> utf8
 * content), by walking the live machine using a snapshot. Used by both the CLI
 * exporter and the host-plugin push gateway. Content is plain text only;
 * binary assets and secret-ish files (.env / credentials* / token* ...) are
 * never collected.
 */
export function gatherLocalFiles(snap) {
  const map = new Map();
  const add = (path, content) => {
    map.set(path, { content, sha: blobSha(content), size: Buffer.byteLength(content, "utf8") });
  };
  const catalog = {
    schema: snap.schema,
    generatedAt: snap.generatedAt,
    profile: {
      name: snap.profile.name,
      bundles: snap.profile.bundles,
      plugins: snap.profile.plugins.map((p) => ({
        name: p.name, declared: p.declared, installed: p.installed,
        description: p.description, homepage: p.homepage, repository: p.repository,
        inBundles: p.inBundles, sourceKind: p.sourceKind,
      })),
      patchReload: snap.profile.patchReload,
      hasPatchFile: snap.profile.hasPatchFile,
    },
    presets: snap.presets.items.map((p) => ({ name: p.name, displayName: p.displayName, hasCordis: p.hasCordis, localPluginMounts: p.localPluginMounts })),
    skills: snap.skills.items.map((s) => ({ name: s.name, description: s.description, kind: s.kind, sourceUrl: s.sourceUrl, sourceType: s.sourceType, lockSkillPath: s.lockSkillPath })),
    envRefs: snap.envRefs,
    note: "envRefs 仅记录环境变量/凭据名，值永不离开本机。",
  };
  add("catalog.json", JSON.stringify(catalog, null, 2));
  add("README.md", "# dsh-sync-manager backup\n\n由 dsh-sync-manager 生成。新机器还原请见插件 GUI 或 repo-tools/restore.mjs。\n");
  for (const p of snap.presets.items) {
    for (const f of p.files) {
      if (SECRET_FILE.test(f.path)) continue;
      const full = join(snap.presets.root, p.name, f.path);
      const content = safeReadUtf8(full);
      if (content === null) continue;
      add(`presets/${p.name}/${f.path}`, content);
    }
  }
  for (const s of snap.skills.items) {
    const base = s.root || snap.skills.root; // 条目级 root（如 ~/.agents/skills）优先
    for (const f of s.files) {
      if (SECRET_FILE.test(f.path)) continue;
      const full = join(base, s.name, f.path);
      const content = safeReadUtf8(full);
      if (content === null) continue;
      add(`skills/${s.name}/${f.path}`, content);
    }
  }
  return map;
}

/** Every file this machine's snapshot wants in the backup repo (metadata-only). */
export function repoFilesFromSnapshot(snap) {
  const map = gatherLocalFiles(snap);
  const files = new Map();
  for (const [path, f] of map) files.set(path, { sha: f.sha, size: f.size });
  return { files };
}

/** Build the push plan: which repo files to upload / delete, given remote tree map. */
export function buildPushPlan(localFiles, remoteFiles) {
  const toUpload = [];
  const unchanged = [];
  for (const [path, f] of localFiles) {
    const remote = remoteFiles.get(path);
    if (!remote) toUpload.push({ path, action: "create" });
    else if (remote.sha !== f.sha) toUpload.push({ path, action: "update", remoteSha: remote.sha });
    else unchanged.push(path);
  }
  const toDelete = [];
  for (const [path] of remoteFiles) {
    if (!localFiles.has(path)) toDelete.push(path);
  }
  return { toUpload, toDelete, unchanged };
}
