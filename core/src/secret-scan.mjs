// Secret / credential scanner. Used as a hard gate before anything is allowed
// to be uploaded to the backup repo. Reports findings with masked samples only.

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";

const RULES = [
  { id: "github-pat", re: /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}/g },
  { id: "openai-sk", re: /sk-[A-Za-z0-9]{16,}/g },
  { id: "aws-access-key", re: /AKIA[0-9A-Z]{16}/g },
  { id: "google-api", re: /AIza[0-9A-Za-z_-]{20,}/g },
  { id: "slack", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: "jwt-ish", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g },
  { id: "auth-header", re: /(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=_-]{12,}/gi },
  {
    id: "assignment-long",
    re: /(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|client[_-]?secret|pat|credential)\s*[:=]\s*["']?([A-Za-z0-9._~+\/-]{18,})/gi,
    valueGroup: 1,
  },
];

function shannon(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function mask(s) {
  if (s.length <= 8) return "<redacted>";
  return s.slice(0, 3) + "…" + s.slice(-3);
}

function isRef(value) {
  const v = value.trim();
  if (/^\$\{?[A-Z][A-Z0-9_]*\}?$/.test(v) || /^<[^>]{1,60}>$/.test(v) || /^\[[^\]]{1,60}\]$/.test(v)) return true;
  // 代码级 env 访问（process.env.X / Deno.env.get / os.environ[...] / getenv('X')）不是密钥值
  if (/^(process\.env|Deno\.env|Bun\.env)\.[A-Z][A-Z0-9_]*$/i.test(v)) return true;
  if (/^(process\.env|Deno\.env)\[[`'"]?[A-Z][A-Z0-9_]*[`'"]?\]$/i.test(v)) return true;
  if (/^(os\.environ\.get|os\.getenv|getenv|getEnv|Deno\.env\.get)\([`'"]?[A-Z][A-Z0-9_]*/i.test(v)) return true;
  // 纯点号标识符链（config.clientSecret / tokens.access_token）是代码引用，非字面密钥
  if (/^[a-z_$][\w$]*(\.[a-z_$][\w$]*)+$/i.test(v)) return true;
  return false;
}

/** 占位符/示例值启发式：仅用于放行文档模板中的假密钥（真令牌必须继续拦截） */
export function isPlaceholderValue(value) {
  const v = value.trim();
  if (/^(x+|\*+|-+)$/i.test(v)) return true;
  return /(XXX|x{4,}|\bxxx\b|YOUR_|your[_-]|REPLACE|replace[_-]?me|example|sample|dummy|change[-_]?me|placeholder|demo[_-]?key|test[_-]?key|foobar|lorem)/i.test(v);
}

export function scanText(text, source = "") {
  const findings = [];
  const seen = new Set();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      let value = rule.valueGroup ? m[rule.valueGroup] : m[0];
      if (isRef(value)) continue;
      if (rule.entropyMin && shannon(value) < rule.entropyMin) continue;
      if (value.length < (rule.entropyMin ? 16 : 12)) continue;
      const key = `${rule.id}:${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ source, rule: rule.id, sample: mask(value), at: m.index, placeholder: isPlaceholderValue(value) });
    }
  }
  return findings;
}

export function scanFile(filePath) {
  const size = statSync(filePath).size;
  if (size > 4 * 1024 * 1024) return [];
  const text = readFileSync(filePath, "utf8");
  return scanText(text, filePath);
}

export function scanAllTextFiles(rootDir, { exclude = /\\node_modules\\|\\.git\\|\\dist\\|\\.pnpm\\/ } = {}) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = `${dir}\\${name}`;
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!exclude.test(full + "\\")) walk(full);
        continue;
      }
      if (st.size > 4 * 1024 * 1024) continue;
      if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|7z|gz|jar|node|db|sqlite|wasm|woff2?)$/i.test(name)) continue;
      try {
        out.push(...scanFile(full));
      } catch { /* binary / non-utf8 */ }
    }
  };
  if (existsSync(rootDir)) walk(rootDir);
  return out;
}
