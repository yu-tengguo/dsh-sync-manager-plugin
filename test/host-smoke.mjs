// host 半冒烟测试：mock ctx/webServer，验证 /sync/api 网关关键路径。
// 运行：node --preserve-symlinks test/host-smoke.mjs
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

// 从安装点（link: junction）加载，配合 node --preserve-symlinks 让父链走 profile 闭包。
const INSTALLED = "file:///C:/Users/ddnin/.dsh/profiles/web/node_modules/dsh-sync-manager/lib/index.js";
const mod = await import(INSTALLED);

// ---- mock services ----
const secrets = new Map();
const credentials = {
  async resolve(ref) { return secrets.has(ref.name) ? { value: secrets.get(ref.name), source: "file" } : undefined; },
  async set(ref, value) { secrets.set(ref.name, value); },
};
const webServer = {
  routes: [],
  register(spec) { this.routes.push(spec); return () => { this.routes = this.routes.filter((r) => r !== spec); }; },
};
const settings = { register(ns, schema, opts) { return {}; } };

function makeCtx() {
  const services = { settings, webServer, credentials };
  return {
    inject(list, fn) { if (list.includes("settings")) fn({ settings: services.settings }); return () => {}; },
    effect(fn) { const dispose = fn(); return dispose || (() => {}); },
    get(name) { return services[name]; },
  };
}

function fakeReq(path, body = {}) {
  const req = new EventEmitter();
  req.method = "POST";
  req.url = path;
  req.headers = { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080", "content-type": "application/json" };
  queueMicrotask(() => { req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end"); });
  return req;
}
function fakeRes() {
  const res = { statusCode: 0, headersSent: false, body: "" };
  res.setHeader = () => {};
  res.end = (str) => { res.body = str; };
  return res;
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  ok: ${label}`); }
  else { fail++; console.error(`FAIL: ${label} ${extra || ""}`); }
}

const ctx = makeCtx();
mod.apply(ctx, { repoOwner: "yu-tengguo", repoName: "dsh-sync-manager", tokenEnv: "GITHUB_SYNC_TOKEN" });
check("gateway registered", webServer.routes.length === 1, `routes=${webServer.routes.length}`);
const route = webServer.routes[0];
check("prefix /sync/api", route.path === "/sync/api");

// 1) status（无 token）
{
  const res = fakeRes();
  await route.handler(fakeReq("/sync/api/status"), res);
  const j = JSON.parse(res.body);
  check("status ok", j.ok === true);
  check("status tokenConfigured=false", j.data.tokenConfigured === false, JSON.stringify(j.data));
  check("status home points .dsh", typeof j.data.home === "string" && j.data.home.includes(".dsh"));
}

// 2) token-set → 再 status 应显示已配置
{
  const res = fakeRes();
  await route.handler(fakeReq("/sync/api/token-set", { value: "ghp_testtoken1234567890abcdef" }), res);
  const j = JSON.parse(res.body);
  check("token-set ok", j.ok === true && j.data.configured === true, res.body);
}
{
  const res = fakeRes();
  await route.handler(fakeReq("/sync/api/status"), res);
  const j = JSON.parse(res.body);
  check("status tokenConfigured=true", j.data.tokenConfigured === true);
  check("值未回显", !JSON.stringify(j).includes("ghp_testtoken"), "token leaked into status!");
}

// 3) snapshot（真实读取本机）
{
  const res = fakeRes();
  await route.handler(fakeReq("/sync/api/snapshot"), res);
  const j = JSON.parse(res.body);
  check("snapshot ok", j.ok === true && j.data.plugins.length === 4 && j.data.presets.length === 8 && j.data.skills.length === 5, res.body.slice(0, 300));
}

// 4) origin 拒绝（跨站：Origin=evil.com 而 Host=DSH 服务器）
{
  const req = new EventEmitter();
  req.method = "POST"; req.url = "/sync/api/status";
  req.headers = { host: "127.0.0.1:3080", origin: "http://evil.com", "content-type": "application/json" };
  queueMicrotask(() => { req.emit("data", Buffer.from("{}")); req.emit("end"); });
  const res = fakeRes();
  await route.handler(req, res);
  const j = JSON.parse(res.body);
  check("跨站 origin 被拒", res.statusCode === 403 || (j.ok === false && j.error.code === "origin-not-allowed"), `code=${res.statusCode}`);
}

// 5) 新方法错误路径（不触网/不改本机）
async function expectErr(methodPath, body, code) {
  const res = fakeRes();
  await route.handler(fakeReq(methodPath, body), res);
  const j = JSON.parse(res.body);
  const cond = j.ok === false && (j.error.code === code || res.statusCode >= 400);
  check(`err path ${methodPath} -> ${code}`, cond, `code=${j.error?.code} status=${res.statusCode}`);
}
await expectErr("/sync/api/install", { spec: "-D evil" }, "bad-request");      // 规格以 - 开头 → 拒绝
await expectErr("/sync/api/install", { spec: "" }, "bad-request");
await expectErr("/sync/api/remove", { name: "../etc" }, "bad-request");          // 非法插件名
await expectErr("/sync/api/restore-preview", {}, "no-token");                   // 无 token
await expectErr("/sync/api/update-check", {}, "no-token");
await expectErr("/sync/api/push", {}, "no-token");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
