// 只读核对备份仓元数据（token 从本机凭据读取，不落命令行/日志）
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const f = join(process.env.DSH_HOME || join(homedir(), ".dsh"), ".credentials.yaml");
const raw = readFileSync(f, "utf8");
const m = raw.match(/^\s{2}GITHUB_SYNC_TOKEN:\s*(.+)\s*$/m);
if (!m) { console.error("no token"); process.exit(1); }
const token = m[1].trim().replace(/^['"]|['"]$/g, "");
const res = await fetch("https://api.github.com/repos/yu-tengguo/dsh-sync-manager", {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "dsh-sync-manager", "X-GitHub-Api-Version": "2022-11-28" },
});
const j = await res.json();
console.log(JSON.stringify({
  full_name: j.full_name, private: j.private, default_branch: j.default_branch,
  created_at: j.created_at, pushed_at: j.push_updated_at || j.pushed_at, html_url: j.html_url, size_kb: j.size,
}, null, 2));
