# T11 Windows · 宿主与 Manager 实机验收（W-O，对应 T11-O/#35 的 Windows 等价）

- 日期：2026-09-07（Windows 实机）
- 父 Issue：#12 [T11]；项目 map：#1
- 镜像：macOS 任务 #35（T11-O），本报告为其 Windows 等价验收；Windows 部分当时被 macOS 批次推迟，本轮按用户指示在本 Windows 机执行。
- 机器记录：`repo-tools/t11-w-o-2026-09-07.json`

## 环境绑定（实际值，不冒充）

| 项 | 实际值 |
|---|---|
| OS / 架构 | Windows_NT 10.0.28000.0 / AMD64 |
| 账户 | ddnin（注意：macOS 任务写的是 ddnine9；如实记录差异） |
| Node / pnpm / Git | v25.8.0 / 11.7.0 / 2.45.1.windows.1 |
| DSH CLI | **0.1.1-rc.2**（macOS issue 文本写 0.1.2-rc.1；本机实际为 rc.2，如实绑定） |
| GUI | 独立实例 `http://127.0.0.1:3190`（日常实例在 3080，未触碰） |

## 隔离

- 独立 `DSH_HOME=C:\新建文件夹\dsh-sync-manager-plugin\t11w\dsh-home`，全新 web profile。
- 日常 `C:\Users\ddnin\.dsh` 全程只读核对（读取版本/参考包清单），零写入。
- 合成凭据（`ghp_synthetic_t11w_test_only_0001`）只进隔离 home 的 `.credentials.yaml`；未使用/写入任何真实凭据，无真实 GitHub 写入。

## 执行与结果

### 1) 独立环境 + 官方安装 Manager 精确 pack
- `npm pack` 本仓库 → `dsh-sync-manager-0.1.0.tgz`（最终 SHA256 `FC88240EF814E07058C72D627E199E91723B170FE4DAA09C7EFAC9DCA9D10DBC`）。
- 官方 `dsh plugin --profile web add file:…/dsh-sync-manager-0.1.0.tgz`（exit 0）安装进隔离 profile。
- `dsh web --no-open --port 3190` 启动。

### 2) 首轮发现并修复的缺陷（均在本仓库工作树最小修复，本地 commit `1eee38e`）
- **d1 干净 Profile 无法启动**：公开 0.1.0 pack 在全新 profile 中启动失败
  `ERR_MODULE_NOT_FOUND: Cannot find package 'schemastery' imported from …\dsh-sync-manager\lib\index.js`，
  整个插件树加载失败导致 `dsh web` 中止。根因：`lib/index.js` 顶层 `import z from "schemastery"`，但
  `package.json` 无任何运行时依赖；日常 profile 只是借 host/其它插件 hoist 才可解析。
  修复：`package.json` 增加精确依赖 `"schemastery": "3.18.0"`（与 npm latest、生态已验证版本一致）。
- **d2 settings-file 改动对 host 无效**：网关读取 apply 时闭包配置快照，`settings.yaml` 里
  `sync-manager.repoOwner/repoName/…` 即便持久化、重启也不生效。
  修复：`lib/index.js` 网关逐请求读取已注册 settings scope（`scope?.get?.() ?? baseCfg`），
  使 settings-file 编辑热生效，无需重启 host。

### 3) GUI 验证（隔离实例，截图在 t11w/out/w-o-*.png）
- 设置 → 插件 → 插件配置 出现「插件与技能管家」卡片；插件列表 sync-manager 已启用/已挂载。
- 「状态」输出真实：隔离 home、`仓库: yu-tengguo/dsh-sync-manager-plugin@main (公开)`（settings 生效）、
  `凭据(GITHUB_SYNC_TOKEN): 未配置/已配置`、增删后询问同步。
- 「盘点」在隔离 profile 输出：npm 插件 2（@deepseek-ai/dsh-base、dsh-web-app）、预置 0、skills 5、仓库将含文件（估算）42；envRefs 无。
- GUI「保存 PAT」→ 合成 token 存入隔离 `.credentials.yaml`（refs: GITHUB_SYNC_TOKEN），状态变「已配置」；
  重启后仍有效（持久化）。
- 错误路径不冒充空 Catalog：合成无效 token 下「仓库差异」返回
  `GET /repos/yu-tengguo/dsh-sync-manager/git/trees/main?recursive=1 -> HTTP 401: Bad credentials`（明确错误而非空结果）。
- **settings-file 持久化 / watch / 重启后有效**：
  1) 写入 `sync-manager:` 覆盖 → 重启后「状态」反映新值；
  2) 运行中再次改 `repoName` → 不重启，「状态」即反映新值（live hot-publish，修复 d2 后）。
- 配置变更后无旧预览：连续两次「仓库差异/还原预览」均以当前配置发起请求（消息里的 repo 路径随配置变化）。

### 4) dsh-better-sidebar@0.18.0（T11-O 固定版本）与 node-pty 闭包
- 官方 CLI `dsh plugin --profile web add dsh-better-sidebar@0.18.0`：
  - 首次（`allowBuilds.node-pty=true`）因 node-pty install 脚本 spawn 子进程被会话沙箱拒绝（`spawn EPERM`），pnpm 失败并**回滚干净**（package.json 未留依赖）；
  - 第二次（无 allowBuilds）pnpm 以 `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: node-pty@1.1.0` 完成（CLI 报 exit 1，依赖与包树已就位）。
- **node-pty 闭包结论（Windows x64）**：node-pty@1.1.0 自带 `prebuilds/win32-x64/pty.node|conpty*`，
  `require('node-pty')` 直接加载成功（无需编译）；因此“忽略 build”不影响本机运行闭包。node-gyp/VS 编译路径未触发。
- 重启后 `ui-sidebar` 已启用，GUI 正常（无启动失败）。
- **终端输出/resize/reconnect：NOT-RUN** —— node-pty 运行时 spawn 被本会话沙箱管道策略拒绝（`spawn EPERM`），
  需在无沙箱 Windows 主机复测（记录为环境限制，非产品缺陷）。
- GUI「安装」按钮（/sync/api/install → hostops `spawn('pnpm', … stdio:pipe)`）同样受沙箱 `spawn EPERM` 影响；
  官方 CLI 安装路径已验证可用（README 亦以 CLI 为首选安装方式）。

### 5) 生命周期 / 失败重试与保留
- 失败安装（sidebar 首次，build EPERM）后 profile 干净、Manager 与 GUI 不受影响（重启 boot5/boot6 正常）→ 失败项可重试、成功项保留。
- 官方 `dsh plugin --profile web remove dsh-better-sidebar`（exit 0）后重启（boot7）GUI 正常、Manager 卡片仍在 → 普通卸载后测试 Profile 仍可启动。

## 结论 / 状态

| 验收点（对应 T11-O Windows 等价） | 结果 |
|---|---|
| 绑定实际 Windows/Node/DSH；固定依赖闭包再执行 | ✅（DSH 0.1.1-rc.2 如实记录） |
| 官方 CLI 在自有测试 Profile 安装本地精确 pack | ✅（含 pack SHA） |
| 实际启动 Host/GUI，Manager 卡片/状态/Local Mode/pending 语义 | ✅（卡片、状态、无密钥 Local Mode） |
| 正式 settings-file 持久化、watch、重启后有效、错误配置不空目录 | ✅（修复 d2 后） |
| 固定 sidebar@0.18.0 安装与 node-pty 闭包 | ✅（prebuild win32-x64 加载成功） |
| GUI 终端输出/resize/reconnect | ⚠️ NOT-RUN（沙箱 spawn EPERM；环境限制） |
| GUI 安装 worker | ⚠️ NOT-RUN（同上沙箱限制；CLI 路径已验证） |
| 失败重试与已成功项保留 / 普通卸载后 Profile 可启动 | ✅ |
| 交付 docs + 机器记录 + 修复 commit | ✅（本文档 + t11-w-o json + commit 1eee38e） |

## 下一步缺口
- 无沙箱 Windows 主机上复测 GUI 安装 worker 与终端（node-pty spawn）。
- 本公开仓库是 dsh-sync-manager@0.1.0（简单同步管家）；T11 issue 所述更完整的 Manager
  （Built-in release.json 收敛等）不在本公开仓库内，未能据此实测（见机器记录 productScopeNote）。
- #18/#19（T17/T18 真实端到端验收）与最终发布验收仍未完成。
