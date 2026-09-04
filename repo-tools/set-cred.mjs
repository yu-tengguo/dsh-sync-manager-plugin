#!/usr/bin/env node
// 把 stdin 的值安全写入 ~/.dsh/.credentials.yaml 的 refs（键名见 argv[2]）。
// 用法：Get-Content secret.txt | node repo-tools/set-cred.mjs GITHUB_SYNC_TOKEN
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const name = process.argv[2];
if (!name || !/^[A-Z][A-Z0-9_]{2,63}$/.test(name)) { console.error("用法: ... | node repo-tools/set-cred.mjs <ENV_NAME>"); process.exit(1); }
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  const value = raw.trim();
  if (!value) { console.error("空值"); process.exit(1); }
  const f = join(process.env.DSH_HOME || join(homedir(), ".dsh"), ".credentials.yaml");
  let s = existsSync(f) ? readFileSync(f, "utf8") : "version: 1\nrefs:\nrecords: {}\n";
  if (new RegExp(`^\\s{2}${name}:`, "m").test(s)) {
    s = s.replace(new RegExp(`^(\\s{2}${name}:).*$`, "m"), `$1 ${value}`);
  } else {
    s = s.replace(/^(refs:\s*)$/m, `$1\n  ${name}: ${value}`);
  }
  writeFileSync(f, s, "utf8");
  console.log(`stored ${name}: configured=true (value not echoed)`);
});
