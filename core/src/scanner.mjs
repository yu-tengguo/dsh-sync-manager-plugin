// Machine inventory scanner: what is installed on THIS DSH right now.
// Output is a plain JSON snapshot that the sync engine can diff/push/restore.
// Skills discovery roots are wired once the skills research lands (see
// listSkillsCandidates — currently returns [] plus a reason).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

export function profileDir(home = dshHome(), profile = "web") {
  return join(home, "profiles", profile);
}

/** read {name, version, dependencies, bundles, patch} for a profile */
export function readProfile(profile = "web", home = dshHome()) {
  const dir = profileDir(home, profile);
  let raw = readFileSync(join(dir, "package.json"), "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 剥离 UTF-8 BOM
  const pj = JSON.parse(raw);
  const patchPath = join(dir, "cordis.patch.yml");
  return {
    profile,
    dir,
    name: pj.name || profile,
    dependencies: pj.dependencies || {},
    bundles: pj.dsh?.profile?.bundles || [],
    patchReload: pj.dsh?.profile?.patchReload || null,
    hasPatchFile: existsSync(patchPath),
    patchPath,
  };
}

/** resolve installed version of pkg inside profile node_modules (pnpm real dir) */
export function installedVersion(profileDirPath, pkg) {
  const scope = pkg.startsWith("@") ? pkg.split("/")[0] : null;
  const name = scope ? pkg.split("/")[1] : pkg;
  const base = scope ? join(profileDirPath, "node_modules", scope, name) : join(profileDirPath, "node_modules", name);
  try {
    const pj = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
    let repository = pj.repository;
    if (repository && typeof repository === "object") repository = repository.url || null;
    if (repository && typeof repository === "string") repository = repository.replace(/^git\+/, "").replace(/\.git$/, "");
    return {
      installed: pj.version || null,
      description: pj.description || null,
      homepage: pj.homepage || null,
      repository: repository || null,
      resolved: base,
    };
  } catch {
    return { installed: null, description: null, homepage: null, repository: null, resolved: null };
  }
}

/** enumerate npm plugin packages (dependencies that are also in bundles, plus declared deps) */
export function scanNpmPlugins(profile = "web", home = dshHome(), { excludeSelf = true } = {}) {
  const p = readProfile(profile, home);
  const out = [];
  const seen = new Set();
  for (const name of [...p.bundles, ...Object.keys(p.dependencies)]) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (excludeSelf && name === "dsh-sync-manager") continue; // 管家自身不列入被管清单
    const v = installedVersion(p.dir, name);
    out.push({
      name,
      declared: p.dependencies[name] || null,
      installed: v.installed,
      description: v.description,
      homepage: v.homepage,
      repository: v.repository,
      inBundles: p.bundles.includes(name),
      sourceKind: v.resolved ? "profile-node-modules" : "dsh-install-dir",
    });
  }
  return { profile: p.profile, bundles: p.bundles, plugins: out };
}

/** walk a directory, return relative file list (text files with sizes) */
function walkFiles(root, base = "") {
  const out = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === ".pnpm") continue;
      out.push(...walkFiles(full, rel));
    } else {
      out.push({ path: rel, size: st.size });
    }
  }
  return out;
}

/** read all `name: ./xxx` local plugin mounts from a cordis yaml file */
export function localMounts(yamlText) {
  const out = [];
  for (const m of yamlText.matchAll(/name:\s*['"]?(\.\/[^'"\s]+)['"]?/g)) out.push(m[1]);
  return [...new Set(out)];
}

/** enumerate user agent-presets and their file-plugin mounts */
export function scanPresets(home = dshHome()) {
  const root = join(home, ".agent-presets");
  if (!existsSync(root)) return { root, presets: [] };
  const presets = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const cordis = join(dir, "agent.cordis.yml");
    let mounts = [];
    let hasCordis = false;
    let displayName = null;
    if (existsSync(cordis)) {
      hasCordis = true;
      const text = readFileSync(cordis, "utf8");
      mounts = localMounts(text);
    }
    const pyml = join(dir, "preset.yml");
    if (existsSync(pyml)) {
      const line = readFileSync(pyml, "utf8").split("\n").find((l) => /^name:/i.test(l));
      if (line) displayName = line.replace(/^name:\s*/i, "").trim().replace(/^['"]|['"]$/g, "");
    }
    presets.push({
      name,
      displayName,
      hasCordis,
      localPluginMounts: mounts,
      files: walkFiles(dir),
    });
  }
  return { root, presets };
}

/** collect env-var NAME references (only names — never values) from config texts.
 *  Accepts ${NAME} / $NAME interpolation and bare UPPER_SNAKE tokens (>=1 '_'). */
const ENV_REF = /\$\{?([A-Z][A-Z0-9_]{3,})\}?|\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,})\b/g;
export function collectEnvRefs(texts) {
  const set = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(ENV_REF)) {
      const w = (m[1] || m[2] || m[0]);
      if (/[A-Z0-9]{4,}/.test(w) && /_/.test(w) && !/\s/.test(w)) set.add(w);
    }
  }
  return [...set].sort();
}

/** full snapshot */
export function buildSnapshot({ profile = "web", home = dshHome(), agentsHome = null } = {}) {
  const npm = scanNpmPlugins(profile, home);
  const presets = scanPresets(home);
  const profileMeta = readProfile(profile, home);
  const skills = scanSkills({ home, agentsHome });
  const configTexts = [];
  if (profileMeta.hasPatchFile) configTexts.push(readFileSync(profileMeta.patchPath, "utf8"));
  for (const p of presets.presets) {
    const c = join(presets.root, p.name, "agent.cordis.yml");
    if (existsSync(c)) configTexts.push(readFileSync(c, "utf8"));
  }
  for (const s of skills.items) {
    for (const f of s.files) {
      const c = join(skills.root, s.name, f.path);
      if (existsSync(c) && /\.(md|yml|yaml|json|js|mjs|py|ps1|txt|example|template)$/i.test(f.path) && !f.path.endsWith(".env")) {
        try { configTexts.push(readFileSync(c, "utf8")); } catch { /* ignore */ }
      }
    }
  }
  return {
    schema: "dsh-sync-manager/snapshot@1",
    generatedAt: new Date().toISOString(),
    machine: { dshHome: home, agentsHome: skills.root, hostname: undefined /* set later if desired */ },
    profile: {
      name: profileMeta.profile,
      bundles: npm.bundles,
      plugins: npm.plugins,
      patchReload: profileMeta.patchReload,
      hasPatchFile: profileMeta.hasPatchFile,
    },
    presets: { root: presets.root, items: presets.presets },
    skills: skills,
    envRefs: collectEnvRefs(configTexts),
    note: "envRefs lists only env-var NAMES referenced by configs; actual values never leave this machine.",
  };
}

/** Scan a skills discovery root: each <name>/SKILL.md (or <name>.md) is a skill. */
export function scanSkills({ home = dshHome(), agentsHome = null } = {}) {
  const ah = agentsHome || process.env.DSH_AGENTS_HOME || join(homedir(), ".agents");
  // discovery roots in DSH rank order (lowest first wins): project, custom, user-dsh, user-agents, bundled.
  // For a user-wide backup we target the user-level roots.
  const roots = [
    { kind: "user-dsh", path: join(home, "skills") },
    { kind: "user-agents", path: join(ah, "skills") },
  ];
  const items = [];
  const lockSource = new Map();
  const lockPath = join(ah, ".skill-lock.json");
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      for (const [id, v] of Object.entries(lock.skills || lock)) {
        if (v && typeof v === "object" && v.sourceUrl) lockSource.set(id, { sourceUrl: v.sourceUrl, sourceType: v.sourceType, skillPath: v.skillPath });
      }
    } catch { /* lock file malformed — ignore */ }
  }
  for (const r of roots) {
    if (!existsSync(r.path)) continue;
    for (const entry of readdirSync(r.path)) {
      const dir = join(r.path, entry);
      const isDir = existsSync(dir) && statSync(dir).isDirectory();
      const skillMd = isDir ? join(dir, "SKILL.md") : null;
      const flatMd = !isDir && entry.toLowerCase().endsWith(".md") ? dir : null;
      const mdPath = skillMd && existsSync(skillMd) ? skillMd : flatMd;
      if (!mdPath) continue;
      let name = isDir ? entry : entry.replace(/\.md$/i, "");
      let description = null;
      try {
        const text = readFileSync(mdPath, "utf8");
        const fm = text.match(/^---\n([\s\S]*?)\n---/);
        if (fm) {
          const nm = fm[1].match(/^name:\s*["']?([^"'\n]+)["']?/m);
          const ds = fm[1].match(/^description:\s*["']?([^"'\n]+)["']?/m);
          if (nm) name = nm[1].trim();
          description = ds ? ds[1].trim() : null;
        }
      } catch { /* skip */ }
      const files = isDir
        ? walkFiles(dir).filter((f) => !/^\.env$/.test(f.path) && !/(^|\/)\.env($|\/)/.test(f.path) && !/(^|\/)(credentials|token|secret)[^/]*\.(json|yaml|yml|txt|env)$/i.test(f.path))
        : [{ path: entry, size: statSync(dir).size }];
      const lock = lockSource.get(name);
      items.push({
        name,
        description,
        kind: isDir ? "folder" : "flat",
        source: r.kind,
        root: r.path,
        sourceUrl: lock?.sourceUrl || null,
        sourceType: lock?.sourceType || null,
        lockSkillPath: lock?.skillPath || null,
        files,
      });
    }
  }
  return { root: ah, items };
}
