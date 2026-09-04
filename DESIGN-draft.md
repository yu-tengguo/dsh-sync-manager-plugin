# dsh-sync-manager（插件与技能管家）— 设计 v0.2（基于四项架构调研）

## 已确认决策（用户 2026-09）
- 备份仓库：**新建 `dsh-sync-manager` 仓库**（源码 + 备份数据同仓），默认**私有**。
- 同步范围：**全量三类**（npm bundle 插件、预置及其文件插件、skills、profile patch 配置）。
- 变更触发：**默认询问**；GUI 提供自动/手动模式（后续版本）。
- token：**GUI 粘贴 PAT → 存本机 `~/.dsh/.credentials.yaml` 的 refs（键名 GITHUB_SYNC_TOKEN）**；任何配置/清单只出现"键名"，永不出现值。

## 架构事实（调研取证，含路径）
1. **插件三平面**：
   - Profile bundle：npm 包，声明 `"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}`，名字进 `profiles/web/package.json` 的 `dsh.profile.bundles`；host 半命名导出 `name/inject/Config(z.object)/apply(ctx,config)`（无 default）；web 半经 `exports["./client"]` 以 lazy-CJS `window.__ModuleLoader__.load({id,factory})` 提供。安装= `dsh plugin --profile web add <file:|link:|github:|git+https: spec>`（pnpm 转发 + reconcile 自动写 bundles；相对路径锚定调用者 cwd）。
   - 预置文件插件：`~/.dsh/.agent-presets/<p>/agent.cordis.yml` 里 `- name: ./x.mjs`；文件随预置目录走。
   - skills：`<发现根>/<name>/SKILL.md`（frontmatter 仅 name/description 必填）。发现根 rank：项目 .dsh/skills(100) → 项目 .agents/skills(200) → custom(300) → `~/.dsh/skills`(400) → `~/.agents/skills`(500, 本机 5 个技能都在此) → bundled(600)。**无内置安装器**：拷贝/删除即装即卸（chokidar 热生效）。来源链接在 `~/.agents/.skill-lock.json`（外部工具维护，DSH 不读写，可作为"链接"来源）。
2. **GUI 注册**（关键）：设置页"插件配置"只渲染 **Host 注册的 settings 命名空间 ∩ 浏览器 `settings.plugin.item` 卡片（key=同名命名空间）** 的交集；表单手写、schema(schemastery) 信封下行校验（settingsScope.bind/describe）。"插件列表"(169) 是 Loader 只读投影，无生命周期操作。
3. **凭据**：唯一正规密钥仓 = `~/.dsh/.credentials.yaml`（refs/records，明文 0600，Windows 不校验权限位）；解析优先级 进程env > refs > <cwd>/.env > $DSH_HOME/.env。配置面只写名字（`apiKeyEnv`/`tokenEnv`，`z.string().role("credential-ref")`），取用 `await ctx.credentials.resolve(credentialRef(name))`（模板：dsh-webhook-github）。**本机 DDNINE_API_KEY/TAVILY_API_KEY 只存在 .credentials.yaml**。
4. **无运行时热装 API**：plugin-inventory 只读、updater 只更新桌面壳、`patchReload:live` 是惰性元数据（0.1.1-rc.2 无消费者）。生效= `dsh plugin add` 后 client 刷新、host 需重启。GUI 唯一"安装"先例（better-sidebar）只是复制命令。
5. **新机器**：`npm i -g @deepseek-ai/dsh` → `dsh web` 即初始化 profile（bundles=base+web-app，**零拷贝、无需 pnpm/网络**）；树外插件才需 pnpm。安装管家插件 = `dsh plugin --profile web add <spec>`。
6. **网络约束**：本机 git push 到 github.com 不可达，只有 api.github.com 可达 → 同步引擎用 REST contents API（复用用户既有 uploader 模式）。新机 bootstrap 用 REST zipball 下载 + file: 安装。

## 仓库结构（最终）
```
dsh-sync-manager/              ← 管家插件源码（npm 包，含 dsh.bundle.patch → cordis.patch.yml）
  lib/index.js                 ← host 半：settings 命名空间 sync-manager + 服务（spawn pnpm、写文件、调 REST）
  lib/client.js                ← web 半：注册 设置→插件→插件配置 卡片（管家控制台：盘点/同步/还原/更新/变更开关）
  core/                        ← 纯 Node 引擎（已实现并离线验证）：snapshot/export-repo/restore-plan/secret-scan/github REST
  repo-tools/restore.mjs       ← 新机引导脚本（REST 下载 zipball → dsh plugin add file: → 打开 GUI）
  README.md / docs/install.md  ← 新机引导
```
备份仓库内容（由 export-repo 生成）：`catalog.json`（bundles/插件版本/presets 元数据/skills 元数据+来源URL/envRefs 名字）+ `presets/<name>/*` 全文件 + `skills/<name>/*` 全文件（跳过 .env/credentials* 类文件）。

## 安全红线（引擎已内置并在导出前强制）
- 上传前对每个待传文件跑 secret-scan（ghp_/sk-/AKIA/AIza/Bearer/私钥/赋值式 token 等特征 + .env 类文件名黑名单）；命中即整批拒绝并列出（脱敏样例）。
- 只同步 env/凭据**名**（envRefs 数组），值永远只在 `~/.dsh/.credentials.yaml`。
- GUI 显示 PAT 仅"已配置/未配置"，粘贴后立即 `ctx.credentials.set` 存储、不回显、不上传。

## 工作分解（剩余）
1. 搭 npm 包骨架（package.json dsh.bundle/client、host 半 minimal apply+settings 注册）并 file: 装入 web profile。
2. host 半服务：盘点（复用 core）、执行安装/还原（spawn pnpm add/remove + reconcile bundles + 写 presets/skills 目录）、GitHub REST 同步（token 从 credentials.resolve）。
3. client 半：lazy-CJS 入口按 ego-browser 产物格式手写；注册"插件配置"卡片（控制台 UI：三类清单、同步、还原、更新、变更确认开关、PAT 粘贴框）。
4. 端到端：本机 GUI 验证（卡片出现、盘点显示、dry-run 同步计划）；用 GITHUB_SYNC_TOKEN 真推一次 catalog 到新私有仓验证。
5. 文档：新机引导（repo-tools/restore.mjs）、变更同步流程、FAQ（token 安全）。

---

# 实现状态 v0.3（2026-09-04，round 3-4）

## 已完成并验证（离线/本机）
- **[x] 1+2 host 半**：`lib/index.js`（settings NS + `/sync/api` 网关）+ `lib/hostops.mjs`（pnpm 装/卸 + bundles reconcile + 仓库拉取到临时目录 + 还原执行）。方法：`status/token-status/token-set/snapshot/push/diff/install/remove/restore-preview/restore/update-check/update`。输入校验白名单、typed ApiError、同源校验、上传前 secret-scan（命中 409 拒绝）。
- **[x] 3 client 半（静态就绪）**：`lib/client.js` 手写 lazy-CJS；对照 `dsh-cordis-client-runner` 源码核对动态 ctx 白名单语义（需 `inject:['slots']` 已声明；`slots.register({name,key,id,order},Card)` 与 ego 同构）。真实渲染待 GUI 重启验证。
- **[x] 装入 web profile**：先 `file:` 后改 `link:`（实时源码）；bundles 已追加 `dsh-sync-manager`（下次重启装载）。
- **[x] 冒烟 16/16**：`node --preserve-symlinks test/host-smoke.mjs`（mock ctx/webServer/credentials；token 值不回显断言）。
- **[x] core 修正**：restore-plan 跳过 `sourceKind:'dsh-install-dir'`（内置包不重装）；catalog JSON 读入剥 BOM（scanner.readProfile 与 restore 均处理）。
- **[x] repo-tools/restore.mjs**：纯 Node 还原工具（--local / REST 拉取 / --dry-run；env 只提示名）。本地 fixture dry-run 通过（8 预置 + envRefs 名）。

## 待验证（需要用户协作，不在离线可达范围）
- GUI 重启后卡片真实渲染 + host 网关在本进程可用。
- 真实 GitHub 链路：PAT → 建私有仓 `dsh-sync-manager` → push catalog/diff → 还原/更新实测。
- 新机冷启动：`dsh plugin add github:yu-tengguo/dsh-sync-manager` → GUI 一键还原。
