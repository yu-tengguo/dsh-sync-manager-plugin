# dsh-sync-manager · DSH 插件与技能管家

把本机 DeepSeek Harness (DSH) 已安装的**插件与 skills 盘点成清单**，同步到你的 **GitHub 私有仓库**；
新机器只装这一个管家插件，即可**一键还原**全部插件与 skills。支持 增删后询问同步 / 一键更新 / GUI 可视化管理。
**密钥与 token 绝不入库**——仓库里只有清单、来源链接与"环境变量名"引用。

## 功能

| 能力 | 说明 |
|---|---|
| 盘点 (snapshot) | 4 类：npm bundle 插件、agent 预置里的本地文件插件、skills、patch 配置；附来源链接 |
| 同步 (push) | 全量 diff 后经 **GitHub REST contents API** 上传（`api.github.com`，不依赖 git push） |
| 还原 (restore) | 新机从仓库一键装回全部 npm 插件 + 预置 + skills + bundles |
| 一键更新 (update) | 以仓库 catalog 为基准，版本落后即 `pnpm add name@版本` |
| 增删同步询问 | 安装/删除插件后询问"是否同步到仓库"（默认开，可在设置关） |
| GUI 管理 | 设置 → 插件 → 插件配置 →「插件与技能管家」卡片 |
| 安全 | PAT 只存本机凭据；上传前逐文件密钥扫描；仓库仅同步 env/凭据**名** |

## 快速开始

### 1) 首次安装管家插件


# 从仓库（该仓库同时是插件包，含 package.json）
dsh plugin --profile web add github:yu-tengguo/dsh-sync-manager
```

重启 dsh web → **设置 → 插件 → 插件配置** 出现「插件与技能管家」卡片。

### 2) 配置同步目标

卡片里粘贴一次 GitHub PAT（只存本机 `~/.dsh/.credentials.yaml`，名 `GITHUB_SYNC_TOKEN`）。
目标仓库可在 设置/`config.yaml` 调整：`repoOwner` / `repoName`(默认 `dsh-sync-manager`) / `branch` / `isPrivate`。

### 3) 日常

- **盘点**：看本机装了哪些插件/skills（含来源链接）
- **同步到 GitHub**：把变更推送到仓库（自动建私有仓、自动 diff、自动密钥扫描）
- **新增/删除插件**：GUI 输入 npm/git/file 规格 → 装完询问是否顺手同步
- **还原/更新**：另一台机器装好本插件后，一键从仓库还原或把已装项更新到 catalog 版本

### 4) 新机还原（无 GUI 也可）

```bash
# 该仓库已含 core/ 与工具，纯 Node 即可：
node repo-tools/restore.mjs --owner yu-tengguo --dry-run   # 预览
GITHUB_TOKEN=ghp_... node repo-tools/restore.mjs --owner yu-tengguo
```

## 仓库结构（备份目标仓库）

```
catalog.json          # 全量清单：插件(含来源链接/版本/来源类型)、预置、skills、envRefs(仅名)
README.md             # 说明
presets/<name>/…      # agent 预置目录原文（文本文件；二进制资产被排除）
skills/<name>/…       # skills 目录原文（文本；.env/credentials/token* 被排除）
```

> `envRefs` 只含变量**名**（如 `DEEPSEEK_API_KEY`）。值保存在各机器自己的凭据区/环境，
> 还原时仅提示"需要你提供以下 env"。

## 安全模型

- **token 永不上传**：PAT 经 DSH 凭据服务按名解析（`tokenEnv` 配置名），仅存本机 `.credentials.yaml`；
  REST 客户端逐调用传入，不落盘不写库。
- **上传前逐文件密钥扫描**：github PAT / openai / aws / google / slack / 私钥 / JWT / Authorization 等
  精确模式；命中即整体拒绝（`409 secret-blocked`）。
- **白名单文件**：只收 `catalog.json / README.md / presets/… / skills/…` 文本文件；
  `.env`、credentials*/token*、二进制（png/zip 等）一律不收集。
- **同源校验**：`/sync/api` 网关只接受同 Host 的 POST。
- **输入校验**：插件规格/插件名白名单正则，pnpm 以参数数组 spawn（无 shell 注入）。

## 开发

```bash
pnpm --dir "$HOME/.dsh/profiles/web" add link:C:/path/to/dsh-sync-manager   # 实时源码依赖
node --preserve-symlinks test/host-smoke.mjs                                 # 网关冒烟（16 项）
node repo-tools/restore.mjs --local test-fixture-repo --dry-run              # 还原计划预览
```

Host 半改动 → 重启 dsh web 生效；client（GUI 卡片）改动 → 刷新页面即可。

## 目录

- `core/src/` 引擎（scanner / secret-scan / github REST / plan / restore）
- `lib/` 插件本体（host `index.js`、网关操作层 `hostops.mjs`、web `client.js`）
- `repo-tools/` 纯 Node 还原工具
- `test/` 冒烟测试
- `DESIGN-draft.md` 设计文档（决策与证据）

## License

MIT
