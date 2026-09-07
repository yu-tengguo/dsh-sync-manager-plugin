# T11 Windows · 浏览器工具实机验收（W-P，对应 T11-P/#36 的 Windows 等价）

- 日期：2026-09-07（Windows 实机）
- 父 Issue：#12 [T11]；镜像：macOS 任务 #36（T11-P）
- 调研：`repo-tools/t11-w-p-2026-09-07.json`、`t11w/candidates/RESEARCH-P.md`（candidates 目录在仓库外，证据保留）

## 固定候选的公开可得性（全部带 HTTP 证据，见 RESEARCH-P.md）

| 候选 | 状态 | 证据要点 |
|---|---|---|
| Ego 统筹修复提交 `d485d085…` | **来源缺失（blocker）** | 上游 dsh-ego-browser（Fisfzy/dsh-ego-browser，公开）commits API 422 / git 对象 404 / codeload 404；5 分支 6 tag 15 PR 15 fork 全无此 SHA → 仅 macOS 侧持有 |
| dsh-ego-browser@0.8.0（npm 唯一版本，2026-08-26） | **本机已装 = 真实 Ego 运行时** | registry tarball SHA-256 `d71035c6…`；包内纯 JS + win32 探测代码（Chrome/Edge/Brave、FFmpeg、PowerShell） |
| @yu-tengguo/dsh-browser-tool 0.2.0（`7e1eb31…`；勿用 `453a42a…`） | **未公开发布（blocker）** | npm registry / npmmirror / GitHub Packages 全 404；yu-tengguo/dsh-browser-tool 公开仓库仅 unpinned main head `a0770522…`（13 commits，无 tag），身份不匹配不得冒充 |
| 本机真实浏览器 | ✅ Chrome 152.0.7977.65（Program Files）、Edge 152.0.4191.53（x86）已安装 | ego doctor：egoBin 即 dsh-ego-browser runtime，Chrome 探测命中 |

## 实机执行与结果

### 1) Ego 运行时（dsh-ego-browser@0.8.0，即本会话 ego 工具链的底层）
- Chrome/Edge 探测：✅（doctor 命中 `C:\Program Files\Google\Chrome\Application\chrome.exe`；Edge 亦在候选路径，未强制启动）。
- Chrome 启动：**环境受限失败（记录，非产品判定）**——多次尝试均
  `Error: Chrome did not expose a DevTools port within 20000ms`（runtime `chrome.mjs waitForEndpoint`）。
  本会话为受限代理会话（pwsh 沙箱下 node 子进程 spawn 一律 EPERM；Chrome DevTools 端口 20s 超时），
  不能据此判定 0.8.0 在正常 Windows 桌面的可用性（README 声明已通过 Windows 实机验收，v0.8.3 面向 DSH≥0.1.2-rc.1；本机 DSH 0.1.1-rc.2 对应 v0.8.0）。
- 因此 Ego 的隔离/网络/eval/下载/截图围栏在**候选 0.8.0 自身进程**上：NOT-RUN（环境限制 + pinned commit 缺失）。

### 2) 真实 Windows Chrome（152）功能与围栏等价验证（内置 Chrome 栈，身份如实注明）
对匿名 loopback fixture（`http://127.0.0.1:3961`，仅本机）：
- 导航 + 渲染 + 快照文本（含 UTF-8 中文） ✅
- 点击链接（/json）→ 页面跳转 ✅
- 页面内 JS eval（document.title/innerText/origin） ✅
- 同源 POST（fetch /post）→ 200 JSON ✅
- 重定向链 3 跳（/redirect?n=1→n=3）→ 跟随至终态 ✅
- 显式路径截图 `w-p-builtin-chrome-fixture.png` ✅
- 页面内跨源 fetch https://api.github.com/zen → 200（evaluated from page） ✅
- 公网匿名页 https://example.com → 正常加载 ✅
- 失败可读：fixture /error500 → HTTP 500 文案；404 → not found（不冒充空结果） ✅

### 3) 下载/文件围栏、独立 user-data-dir 驱动
- 独立 ego 进程 + 独立 user-data-dir：因沙箱 EPERM（node 子进程/管道）与 DevTools 超时不可行 → NOT-RUN（环境限制）。
- 下载捕获：内置栈未暴露下载落盘路径断言 → 记录 NOT-RUN，不作为 PASS。
- 隐私门禁：本机用户真实 Chrome 窗口（“SaaS for Business”）被枚举到时**未触碰/未捕获**（遵守只操作任务自建窗口）。

## 结论 / 状态

| 验收点（Windows 等价） | 结果 |
|---|---|
| 候选固定身份绑定与公开源核验 | ✅（两个 pinned commit 均公开缺失，如实 blocker；0.8.0/0.2.0 产物身份证据齐全） |
| Ego 0.8.0（已装真实运行时）Windows 探测 | ✅ Chrome 命中；Edge 在候选路径 |
| Ego 0.8.0 Chrome 启动 + 围栏实跑 | ⚠️ 环境受限（DevTools 超时 + spawn EPERM），NOT-RUN 不冒充 PASS |
| browser-tool 0.2.0 | blocker（未发布；unpinned head 不冒充） |
| 真实 Windows Chrome 功能/围栏等价验证 | ✅（loopback+公网匿名页、eval、重定向、截图显式路径、错误可读） |
| 隐私门禁 | ✅ 未捕获任何用户窗口 |

## 缺口
- 无沙箱 Windows 桌面会话复测 Ego 0.8.0 Chrome 启动/围栏（预计需 5 分钟实机）。
- 两个 pinned commit 一旦可从 macOS 侧取得（或上游公开），补执行即可对齐 macOS PASS。
