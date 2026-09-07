# T11 Windows · Skills 与 CPython 3.14 实机验收（W-Q，对应 T11-Q/#37 的 Windows 等价）

- 日期：2026-09-07（Windows 实机）
- 父 Issue：#12 [T11]；镜像：macOS 任务 #37（T11-Q）
- 机器记录：`repo-tools/t11-w-q-2026-09-07.json`；调研：`t11w/candidates/RESEARCH-Q.md`

## 固定输入公开可得性（带证据，见 RESEARCH-Q.md）

| Skill/输入 | 状态 |
|---|---|
| amazon-category-research @ `d607d661…`（cdeistopened/skill-stack） | ✅ 公开；单 SKILL.md 纯文本工作流，无运行时依赖/无 key/无脚本 |
| screenshot @ `49f948fa…`（openai/skills curated） | ✅ 公开；11 文件，含官方 Windows helper `scripts/take_screenshot.ps1` |
| web-scraper @ M `563c7767…` + `t11-m-lock-v2.json`（cb88888f…） | ❌ 公开来源缺失（GitHub 全局 commits 搜索 0；yu-tengguo/cdeistopened 53 仓库全 404）→ blocker，不得伪造 |
| find-skills（H DSH 适配候选 `25fd52a3…`） | ❌ 公开 Source Reference 缺失 → 仅本地候选试用 |

## 环境
- 独立 `DSH_HOME=t11w\dsh-home` + 独立 `DSH_AGENTS_HOME=t11w\agents-home`（Manager 盘点据此只读自有根）。
- 四个 Skill 装入自有根：amazon、screenshot=官方固定提交副本（fetch 清单见 agents-home/skills/_fetch-manifest.json）；
  web-scraper、find-skills=从日常副本复制的**本地候选**（identity 哈希记录于 README-LOCAL-CANDIDATES.md；日常 Shared Skills 保持只读，未改动）。
- 日常 C:\Users\ddnin\.agents\skills 仅只读比对；ecommerce 不在本批范围。

## CPython 3.14 独立解释器准备（自有目录，零全局改动）
- 官方 python.org 发行 `python-3.14.7-amd64.zip`（35.0 MB 全量 layout zip，非安装器；官方 release 页 + FTP SPDX 佐证），
  下载 SHA-256 `ac1a727a71738e11de80b76e975f9b8a258aea6412bfc31696b929d59c6aafd0`，解压于 `t11w\cp314\py314`。
- `python --version` → **Python 3.14.7**（tags/v3.14.7:823f032, Aug 5 2026, MSC v.1944 64 bit AMD64）。
- pip 26.2.1（自带）。venv bootstrap 在本 layout 下 ensurepip 失败 → 直接装入自有 prefix（py314\Lib\site-packages），仍零全局。
- 沙箱适配记录：本会话沙箱拒绝 python `tempfile.mkdtemp/mkstemp` 创建的受限 ACL 目录内写入（Errno 13，pip 暂存失败），
  以 `sitecustomize` shim（t11w\tools\pyshim）替换为标准 ACL 创建后 pip 全流程可用——纯环境适配，与 skill 无关。
- **自有 hash-lock**（M 官方 lock 公开缺失）：15 个 win_amd64/py3 wheel 离线下载 + SHA-256 清单
  `cp314\wheels\wheels-sha256.lock`；`pip install --no-index --find-links` 离线安装。
  实际闭包：beautifulsoup4 4.15.0、certifi、charset_normalizer 3.5.1、click 8.5.0、idna 3.19、
  **lxml 6.1.3**、**numpy 2.5.3**、**pandas 3.0.5**、python-dateutil、requests 2.34.2、six、soupsieve、typing-extensions、tzdata、urllib3 2.7.0。
- `pip check` → **No broken requirements found**；原生导入 + pandas describe 小运算 ✅。

## web-scraper 四命令实测（新解释器 3.14.7；M 的 44/33/17 为旧解释器证据，未抄用）
匿名自有 loopback fixture（127.0.0.1:3961，同源）+ 少量公开匿名页（example.com）：

| 命令/场景 | 结果 |
|---|---|
| `scrape`（selector h1,p） | ✅ Found 3 elements |
| `scrape --format json/csv` 显式输出 | ✅ JSON/CSV 结构正确 |
| `links --internal-only` | ✅ 7 条内部链接 |
| `emails --depth 1` | ✅ 4 个邮箱 |
| `emails --depth 2`（递归，0.5s 限速） | ✅ 爬到 depth2；递归边界可见 |
| `structured --schema article/product` | ✅ 输出 JSON（title/content/word_count 等） |
| 失败非零：/error500 | ✅ exit 1 + `requests.exceptions.HTTPError: 500 Server Error` 可读 |
| 失败后重试（同命令成功 URL） | ✅ exit 0 |
| 同源/重定向链（3 跳） | ✅ 跟随至终态内容 |
| 公网匿名 https://example.com | ✅ h1=Example Domain（certifi TLS 正常） |

**实测缺陷（Windows 专属，已记录）**：
1. `emails` 命令在 GBK 控制台输出 '•'（U+2022）→ `UnicodeEncodeError: 'gbk' codec can't encode` → exit 1。
   修复/绕过：`PYTHONIOENCODING=utf-8`/`PYTHONUTF8=1` 后正常。→ 记为 skill Windows 缺陷（本地候选可打 patch：click.echo 显式 utf-8）。
2. 递归爬取把 `mailto:` 链接当页面抓（"No connection adapters were found for 'mailto:…'"）→ 异常被捕获、输出可见，不阻断（错误/重试语义 OK）。
3. `get_text` 元素间无分隔 → 邮箱正则捕获粘连文本（如 webmaster@page.acmenext）→ 噪音项（mailto 真值仍在）。

## 实际 DSH 加载场景（独立实例 3190，DSH_AGENTS_HOME 指向自有根）
- 安装/拷贝后 GUI/Host 正常启动，技能文件**不阻塞** Host/GUI ✅
- Manager「盘点」读自有根：**skills 4 个**（amazon、find-skills、screenshot、web-scraper）；文件估算 17 ✅
- 全量重启后重扫：skills 4 保持（内容持久）✅
- 附加 scanner 观察：skills 根下任何扁平 `*.md` 会被当 skill 计数（README 移出后由 5→4）——记录为 scanner 特性/噪音。

## amazon / screenshot / find-skills 的分支结论
- **amazon**：加载/可见 ✅（官方固定副本）；工作流为 Agent 文本步骤（KDP 品类研究，无付费 API/无 key）；
  实机**匿名公网能力前提实测**：内置 Chrome 匿名打开 amazon.com 图书畅销榜 → 正常返回标题/星级/价格（CNY），无机器人拦截 ✅；
  完整 Agent 编排执行需 LLM 会话 → NOT-RUN（本环境无 API key，边界禁止）。
- **screenshot**：官方 Windows helper `take_screenshot.ps1`（纯 .NET）就位、安装阶段无任何权限弹窗 ✅；
  实际捕获**本任务自建窗口**：本会话无可见/可枚举的任务自建窗口（--app 窗口未出现在可枚举桌面；用户真实窗口不可触碰）→
  按“不能捕获个人桌面/用户窗口”门禁记 **NOT-RUN（分支不可执行）**，未做任何系统权限申请/授权。
- **find-skills**：加载/可见/持久 ✅（本地候选）；“发现→提案→预览→确认→安装到 DSH Skill Target”属大 Manager 功能（公开仓库无），
  且固定公开源缺失 → NOT-RUN/blocker，未调用全局 skills CLI。

## 结论 / 状态
- 自有根 + 四个 Skill + CPython 3.14.7 独立解释器 + 离线 hash-lock：✅
- web-scraper 四命令/失败重试/重定向/递归/JSON-CSV/公网页：✅（含 3 个实测缺陷记录）
- 四个 Skill 可见/不阻塞/重启持久：✅
- amazon 匿名公网能力前提：✅；screenshot 实际捕获、find-skills 官方旅程：NOT-RUN（如实分支）
- 交付：本文档 + t11-w-q 机器记录 + 独立 Python 准备证据（cp314 目录 + wheels lock + 日志）

## 缺口
- M/H 固定候选一旦可从 macOS 侧取得 → 以精确身份复跑 web-scraper（44/33/17 等价）与 find-skills 旅程。
- 无沙箱交互桌面复测 screenshot 窗口捕获。
