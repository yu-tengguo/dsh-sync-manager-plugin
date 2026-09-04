// client.js 沙箱冒烟：在近似浏览器环境里执行 factory，验证导出结构与模块级代码无低级错误。
// （真实渲染仍需 GUI 重启后验证。）
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let captured = null;
const sandbox = {
  window: { __ModuleLoader__: { load(spec) { captured = spec; } } },
  console,
  Symbol,
  Object,
  Error,
  Promise,
  fetch: () => Promise.reject(new Error("stub fetch")),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "client.js" });

if (!captured) throw new Error("ModuleLoader.load 未被调用");
if (captured.id !== "dsh-sync-manager") throw new Error(`id=${captured.id}`);

// 用最小 require 桩执行 factory
const reactStub = { useState: (v) => [v, () => {}], createElement: () => ({}) };
const requireStub = (name) => {
  if (name === "react") return reactStub;
  throw new Error(`unexpected require: ${name}`);
};
const mod = captured.factory(requireStub);

let pass = 0, fail = 0;
const check = (label, cond) => { cond ? (pass++, console.log(`  ok: ${label}`)) : (fail++, console.error(`FAIL: ${label}`)); };
check("exports.name=sync-manager", mod.name === "sync-manager");
check("exports.apply 是函数", typeof mod.apply === "function");
check("exports.inject=['slots']", Array.isArray(mod.inject) && mod.inject[0] === "slots");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
