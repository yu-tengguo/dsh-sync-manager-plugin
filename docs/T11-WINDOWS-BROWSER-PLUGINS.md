# T11-U — Host 浏览器插件候选产品面复验（Windows，round-3 隔离环境）

状态：**WIP（进行中快照）** — 记录日期 2026-09-08。本文档是 round-3 交接包
`dsh-sync-windows-correction-c881ac7`（SHA-256 `79961a9246386b70ab16e5af5b0d0d210e3791cdd44328ece3918e9b91fe92a3`）
下 issue #41（T11-U）的阶段性机器报告；上一轮 round-2 记录见
`T11-WINDOWS-BROWSERS.md` / `T11-WINDOWS-SKILLS.md`（W-P/W-Q，同交接包前序轮次）。

## 环境

- 全新隔离任务根：每候选 × 每浏览器独立 `$TASK_ROOT`（含独立 DSH_HOME / HOME / LOCALAPPDATA /
  Profile / 输出目录），候选经官方 `dsh plugin --profile web add <exact tarball>` 安装
  （`file:$USER_HOME/...` 经 ASCII junction 路径，exit 0）。
- Node `22.x`（22.23.2）+ `@deepseek-ai/dsh@0.1.2-rc.1`；无头 host 引导后写 receipt 即退出（exit 1 为正常）。
- Chrome `152.0.7977.65`；Edge `152.0.4191.53`。

## 候选

| 候选 | 版本 | 源码 commit | tarball SHA-256 | preset | 工具 |
|---|---|---|---|---|---|
| dsh-ego-browser | 0.8.2 | `c156b9164fb1b9d7f88c40a993f1a890b1763317` | `20099e8e…` | `ego-browser`* | 32 × `ego_*` |
| @yu-tengguo/dsh-browser-tool | 0.2.0 | `9d64e520…` | `9f9f3b76…` | `yu-tengguo-browser-tool` | 6 × `browser_*` |

\* ego-browser 0.8.2 不以 agentPreset 挂载（roster 仅 standard/ptc/minimal/cordis）；
其 32 个 `ego_*` 工具经上述 roster standing scope 注册并可见（57/57/34/64 总量含 32 ego 工具）。

## browser-tool 候选 — 双浏览器全 PASS（正式 Host 注册表调用）

探针经 `agentPresets.remoteExportList()` / `standingKeyFor(id)` / `ctx.tools.get(name, scope)`
正式调用产品工具；输出自动脱敏（如必应搜索 URL 显示 `search?[REDACTED]`）。

Chrome（receipt `$TASK_ROOT/out/receipt5.json`）与 Edge（receipt `$TASK_ROOT/out/receipt.json`）逐项一致：

- presetSelectable=true，默认 preset=standard；6 工具名单与文档一致；evalExposed=false。
- 公开匿名导航 `https://example.com/` ok（Edge 首跳 `attempts=1`：冷启动失败重试一次后成功）。
- DOM snapshot / read：Example Domain 文本读回 ✓。
- 页面截图 ok：Chrome 11931 B、Edge 11848 B（PNG 落于 package-owned 输出目录，
  `…/browser-tool/output/t11u/page.png`，仅任务自建 headless 页面）。
- 截图路径围栏：越界路径 → `SCREENSHOT_TRAVERSAL_BLOCKED` ✓。
- 刷新 ok；type+click：必应搜索 "DeepSeek" → 结果页标题 `DeepSeek - 搜索` ✓。
- 首请求即私有/环回目标 → `NETWORK_PRIVATE_BLOCKED` ✓；metadata 双 URL
  （`http://metadata.google.internal/`、`169.254.169.254`）均 blocked ✓。
- eval 默认关：`browser_act` 任意页面 JS → `PAGE_EVAL_DISABLED`（需显式 allowPageEval）✓。
- 环回陷阱服务器命中 0（loopback trap hits=0）✓。
- 停止幂等：close1 ✓、close2 ✓；同 package-owned Profile 重启成功（restartSameProfile=true）✓。
- profileIsolated=true / settingsAbsent=true / userPresetCopyAbsent=true。

受限项（无受控公开 fixture，逐项按 not-run 记录，未伪造）：显式下载（httpbin 可达但无受控公开
附件元素可点，loopback 被产品封锁故无法本地 fixture）；iframe/OOPIF、popup、worker/
service-worker/cache 隔离、公开重定向路径——同因按 not-run 待公开 fixture 补测。

## ego-browser 候选 — 中途（阻塞中）

已完成：
- 官方 add 安装 exit 0；32 工具可见（见上）。
- Admission 边界实测（产品表面，非诊断 seam）：
  - `ego_screenshot` 越界绝对路径 → `ego-admission:path-outside-root`（允许根 =
    `<HOME>/.dsh-ego-admission-v1/output` 投影内）✓；
  - `metadata.google.internal` 与 `169.254.169.254` → `ego-admission:host-denied` ✓；
  - `ego_js`（页面 JS）→ `ego-admission:tool-disabled`（同 cdp/cli/script/upload 禁用集）✓。

阻塞（进行中，非产品围栏失败）：
- ego 0.8.2 Windows 设计上恒 headed（`isHeadlessDetected` 对 win32 恒 false；`EGO_LINUX_PROFILE`
  等环境覆盖被 admission 拒绝 → Profile 恒在 `%LOCALAPPDATA%\ego-lite-linux`）。
- dsh-host 工具子进程上下文中 headed 启动失败：`browser did not come up on display
  win32-desktop`，`chrome.mjs:603` 兜底（Xvfb 不可用/win 伪 display）亦失败；runtime 日志未显示
  Chrome 进程存活（无 DevToolsActivePort）。对照：同一会话手动 headed Chrome（含 ego
  DIRECT_NETWORK_FLAGS 全组参数、ASCII user-data-dir）端点可正常起来 → 指向 ego runtime 在
  dsh-host 子进程环境（`isolatedEnvironment` 白名单 env）下的 headed 启动问题，待进一步定位
  （候选：子进程 env 缺关键 Windows 变量、detached 窗口站/令牌上下文差异）。
- 隔离对策验证中：LOCALAPPDATA 指向任务内 ASCII junction 子目录时 Chrome 可正常写
  crashpad 缓存（`Microsoft/Windows/Caches` 等出现），但 ego headed 启动仍失败。

## 未完成（续跑清单）

1. ego-browser：定位并恢复 headed 启动（或确认环境限制 → 如实记 env-not-run）后，
   Chrome 与 Edge 两变体跑通与 browser-tool 同套探针（navigate/snapshot/read/type/click/
   refresh/screenshot/停止/幂等停止/同 Profile 重启 + ego 特有围栏：path 根、host-denied、
   tool-disabled 已验；下载等仍受控公开 fixture 限制）。
2. 两候选官方 remove → preset/工具消失 + package-owned Profile 保留 + 重启验证。
3. controller exit / graceful stop 进程核对（bt 侧 close 幂等已 PASS；进程级 birth-match 核对收尾）。
4. #42（T11-V）：四 Skill 经正式 Manager 全生命周期（独立任务根，未开始）。
5. 全部收尾清理 + 最终脱敏汇总（按共享材料脱敏规则：`$TASK_ROOT`/`$USER_HOME` 投影）。
