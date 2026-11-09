# career-ops · 精简求职流程

这是 [career-ops-hq/career-ops](https://github.com/career-ops-hq/career-ops) 的个人工作流 fork。默认分支为 **`lean-workflow`**。

**预筛选 → 按 JD 生成简历 → Chromium 登录 → 上传与填写 → 按明确授权提交。**

默认仍为人工最终提交。明确授权后可启用[持续自动投递与待答窗口](#持续自动投递与待答窗口)：不限岗位数量，未知问题单独暂存并继续其他岗位，用户回答后记住并复用。

省下 eval、评分报告、公司调研、多模型复审和 Playwright MCP 填表循环；保留事实检查、标题与日期检查、单页检查和提交确认。岗位库更新、解析与去重由本地代码完成。个人 profile、简历、申请记录和浏览器会话不会进入 Git。

[全新电脑安装](#全新电脑安装) · [恢复原电脑资料](#换电脑恢复原有资料) · [日常使用](#日常使用) · [每日定时导入](#每日定时导入) · [模型与-token-预算](#模型与-token-预算) · [命令速查](#命令速查) · [故障排查](#故障排查)

## 全新电脑安装

### 1. 准备工具和账户

| 项目 | 使用版本 / 要求 |
|---|---|
| Node.js | 本次验证版本 **24.16.0**，仓库 `.nvmrc` 已固定 |
| npm | 本次验证版本 **11.11.0**；用 `npm ci` 按 lockfile 安装 |
| Git | 支持 submodule；两个岗位源均使用 HTTPS，读取公开仓库不需要 SSH 私钥 |
| 浏览器 | Playwright **1.64.1** 对应的 Chromium，由安装命令下载 |
| AI 工具 | Codex 桌面应用或 CLI；也可在仓库目录使用 Claude Code |
| 账户 | 按所用 AI 工具登录自己的账户；本精简流程不要求另外配置模型 API Key |

本机验证环境是 macOS、Node 24.16.0。Linux / WSL2 使用相同 Node 命令；Linux 需要补齐 Chromium 系统依赖。Windows 优先使用 WSL2，避免 Git 符号链接和 shell 差异。没有声称在所有操作系统上实测过。

安装 Node 可使用 [Node.js 官方下载](https://nodejs.org/en/download)。已有 nvm 的电脑可在克隆后运行 `nvm install` 和 `nvm use`。

安装并登录 [Codex 桌面应用](https://learn.chatgpt.com/docs/codex)；若使用 CLI，本机验证版本为 `codex-cli 0.153.4`：

```sh
npm install --global @openai/codex@0.153.4
codex login
```

也可用已经安装的更新版 Codex。模型可用性由你的账户和所用产品决定；账户登录和招聘网站登录需要在新电脑重新完成。CLI 安装和登录方式见 [官方说明](https://learn.chatgpt.com/docs/codex/cli)。

### 2. 克隆、安装依赖和 Chromium

```sh
git clone --branch lean-workflow --depth 1 --recurse-submodules --shallow-submodules https://github.com/dogeheng/career-ops.git
cd career-ops

# 已有 nvm 时使用；否则先自行安装上述 Node 版本。
nvm install
nvm use

npm ci --ignore-scripts
npx playwright install chromium
node lean-setup.mjs
node lean-setup.mjs --install-skills
```

没有 nvm 时跳过两条 nvm 命令，先确认 `node --version`。Linux / WSL2 如果缺少浏览器系统库，使用 `npx playwright install --with-deps chromium`，按系统提示安装依赖。

`--ignore-scripts` 避免上游 postinstall 重复尝试下载浏览器；下一行显式安装的是 lockfile 对应的 Chromium。**不要改用无 lockfile 的随意依赖升级，也不要运行上游 `update-system.mjs` 覆盖这个 fork。**

安装脚本把两个 skill 复制到本机 `${CODEX_HOME:-~/.codex}/skills/`，并自动写入当前电脑的项目地址。下一条 Codex 消息可发现它们。已有同名但属于其他目录的 skill 时会报错，不会静默覆盖；移动旧副本后再安装。此命令可在同一目录重复运行以更新 skill。

### 3. 先运行不含私人资料的示例

```sh
npm run demo
npm run test:lean
```

`demo` 在临时目录创建虚构候选人，生成一个单页 PDF，并打印文件地址。它不读取你的 profile、不访问招聘网站、不调用模型。示例可以通过，说明 Node、锁定依赖、内嵌字体、HTML/PDF 生成和事实检查能够协作。

### 4. 加入自己的资料，或恢复备份

若是换电脑，直接按下一节恢复；不必重新填写。

第一次使用则编辑以下本地文件：

| 文件 | 内容 |
|---|---|
| `cv.md` | 真实履历、技能、项目、职位名称、日期和指标，作为简历事实来源 |
| `config/profile.yml` | 联系方式、国家偏好、工作许可、sponsor、毕业及入职时间 |
| `modes/_custom.md` | 精简流程、输出偏好、人工提交和节省 token 的规则 |
| `modes/_profile.md` | 可选的目标岗位说明；不得写入没有来源的经历 |

`lean-setup` 已复制通用 profile 和自定义提示词模板。未知值保留 `null`，由助手询问；不要用 `false` 或 `0` 代替未知。需要提供真实 `candidate.full_name`、`candidate.email` 和 `cv.md` 后再生成自己的简历。

`cv.md` 建议采用以下结构，标题检查会使用它：

```md
# CV — Your Name

## Education
- Your actual degree, university and graduation date

## Work Experience
### Your actual employer
**Your actual title**
Jun 2026 - Aug 2026
- Source-backed contribution and metric

## Projects
### Your actual project
- Source-backed description

## Skills
- Your actual skills
```

这只是结构示例，不可当作自己的事实。

## 换电脑恢复原有资料

**仓库只包含程序和通用模板。只重新 clone 不会恢复你的 profile、基稿、申请记录或岗位去重状态。**

### 旧电脑导出

在旧电脑仓库目录运行：

```sh
node lean-backup.mjs export local/private-backup.json
```

导出文件默认拒绝覆盖已有同名备份；再次导出时换一个文件名。通过你自己的安全文件传输方式，把这个文件带到新电脑。它含个人资料，保存在被 Git 忽略的 `local/`，不要提交到公开仓库。

备份包含：事实库、profile、自定义提示词、简历基稿及生成结果、JD、岗位状态、申请 tracker 和源简历。**不包含 API Key、`.env`、密码、登录 cookie、Chromium 会话、本机 skill 地址或 本机系统任务。**

### 新电脑恢复

先完成全新电脑安装，再运行：

```sh
node lean-backup.mjs import /path/to/private-backup.json --overwrite
node lean-setup.mjs --install-skills
node lean-ingest.mjs
npm run test:lean
```

把 `/path/to/private-backup.json` 换成真实文件地址。`--overwrite` 用于替换刚初始化的空 profile 等允许迁移的资料；导入前会校验所有文件的路径和 SHA-256，不写入仓库代码或凭证目录。已有真实资料的电脑请先另外导出一份备份。

如果系统提示 skill 属于旧地址，可只重新绑定已安装的副本：

```sh
node lean-setup.mjs --bind-skills "$HOME/.codex/skills"
node lean-setup.mjs --install-skills
```

使用自定义 `CODEX_HOME` 时传入它实际的 `skills` 目录。不要复制旧电脑的 `installation.json`。

恢复后需重新登录 Chromium，并按“每日定时导入”在新电脑安装系统任务。若旧电脑仍运行，删除其任务，避免两台电脑各维护一份不同的岗位状态。

依赖版本、静态字体、模板和事实可固定；跨系统 PDF 的元数据或二进制哈希不保证相同。招聘网站、登录验证和实时岗位列表会变化，不能通过备份固定其行为。

## 日常使用

### 发现岗位

在 Codex 直接说：

> 用 `$career-ops-job-ingestion` 刷新 new grad 岗位，只给我新增数量和最多十条待核实岗位。

或在终端运行：

```sh
npm run jobs:ingest
```

两个岗位源：

| 子模块 | 分支 | 导入内容 |
|---|---|---|
| `data/job-sources/2027-swe-college-jobs` | `main` | SpeedyApply 美国及国际 new grad 列表 |
| `data/job-sources/new-grad-positions` | `dev` | Simplify New-Grad-Positions README |

不导入 SpeedyApply internship 列表，不执行源仓库脚本。克隆时使用仓库记录的固定提交；`--refresh` 才跟随上述分支更新。每日更新后，Git 可能显示两个 submodule 指针有变化，这是来源更新，不是个人数据被暂存。

结果保存在 `data/lean/jobs.json`、`shortlist.md`、`last-run.json`。命令直接返回计数和 `top_new`，最多十条新增候选；**不要把完整岗位 JSON 或清单读进模型上下文**。重复运行不会重复入队；申请 tracker 中已有规范 URL 的岗位不会再次被列为待投。来源不再列出的岗位只标为未列出，不自动声称已经关闭。

### 处理一个 JD 并生成简历

在仓库目录打开 Codex，或使用已安装的全局 skill：

> 用 `$career-ops` 精简流程处理这个 JD：……。先检查硬性条件，通过后按真实履历生成单页英文简历；不确定的先问我。

可粘贴 JD 或雇主职位 URL。助手只提取一次 JD；Workday 优先使用其公开 CXS 接口。提取失败时请求你粘贴正文，不反复操纵网页。

默认入口 `auto-pipeline`、`pipeline`、`pdf`、`buildcv`、`apply` 都使用精简模式。公司研究、面试或求职信等上游功能仅在明确要求时按需加载，不是简历生成的前置条件。

### 硬性筛选规则

`screening` 中使用 ISO 两位国家代码，日期格式为 `YYYY-MM-DD`：

| 字段 | 含义 |
|---|---|
| `countries` | 目标招聘国家；不把 remote 理解为全球可工作 |
| `employment_types` | 如 `[fulltime]` |
| `full_time_years` | 已确认全职经验，实习单列、不自行折算 |
| `work_authorization` | 按国家填写现有许可，未知填 `null` |
| `future_sponsorship_required` | 按国家填写未来是否需要 sponsor |
| `graduation_date` / `available_from` | 毕业日、最早入职日 |
| `us_citizen` | 国籍声明独立确认；OPT 不用于推断国籍 |

明确不满足的必要条件才会 `skip`。preferred 不转为硬条件；未说明 sponsor、学位替代、经验是否计入实习等保留 `needs-review`。源列表不是完整 JD 或仍在招聘的证明，选中岗位后还需阅读雇主 JD。

本地预筛 JSON 至少包含 `{url,company,title,country,text,metadata_only:false}`。人工解读确认后还可加入 `min_experience_years`、`requires_existing_authorization`、`sponsorship: no|yes|unknown`、`graduation_from`、`graduation_to`、`latest_start_date`、`citizenship: US`。脚本不声称能全面理解自然语言，无法确定的要求仍应询问。

### 简历字号、所在地与项目选择

默认 `cv.template: lean`：正文 **11pt**，联系方式和项目技术行 **10pt**，次级信息约 **10.5pt**，静态 Vera 字体随 PDF 内嵌，不依赖新电脑安装了什么字体。纸张为 Letter，页边距 0.45 英寸。

`max_pages: 1` 和 `strict_pages: true` 会拒绝超页结果，不会把第二页偷偷裁掉。内容太多时按 JD 精选项目或精简重复句，不自动缩小字号。

- `cv.show_location: false`：省略页眉所在地；显示时也只能使用真实地点。
- `cv.projects: auto`：助手从 `cv.md` 中按 JD 选择真实项目。
- `cv.projects: omit`：不显示项目。
- `cv.projects` 为名称列表：只允许列表内的项目。

基稿已经合适时，助手可只输出变化字段：

```sh
node lean-buildcv.mjs --base output/base-source.json --patch output/job.patch.json output/company-role
```

patch 是 JSON 对象：对象递归合并，数组整体替换，`null` 删除字段。例如 `{"candidate":{"location":null}}`。基稿需由自己的事实库生成；恢复旧基稿后仍以 `cv.md` 核对事实。合并结果会重新运行相同的标题、事实、结构和单页检查。

### Chromium 登录、上传与人工提交

先请求具体投递目的地，生成材料后运行：

```sh
node lean-handoff.mjs --url https://employer.example/application --resume /absolute/path/to/output/company-role.pdf --upload
```

把示例 URL 和文件地址换成真实值。Chromium 使用 `data/lean/chromium/` 下的专用本地 profile。你手动登录、处理 MFA / CAPTCHA，并进入 Resume/CV 上传步骤。

`--upload` 只授权向指定雇主域名的一个明确 Resume/CV 文件框附加一次 PDF；最多等待十分钟，成功或结果不明后都停止自动尝试。多个文件框、非标准控件或跳转到别的域名时改为手动上传，或使用最终雇主申请域名重开。上传后在网页确认附件成功，剩余下拉选择、问题和 **Submit 由你操作**。关闭窗口结束助手。

没有自动填表循环，没有自动注册、邮件发送或最终提交。上传不等于 Applied。你确认已提交后，才通过上游 tracker writer 记录申请，评分用 `N/A`，不虚构评估报告。

## 每日定时导入

默认改用 **macOS launchd 系统定时器**直接运行 `lean-native-run.mjs`，不启动 Codex、不调用 Luna 或其他模型。只有新增且没有被硬条件排除、尚未跟踪的候选岗位，才通过本机通知中心提醒；没有新增时保持安静。提醒是候选发现，不代表 sponsor 或完整 JD 已确认。

| 纽约时间（America/New_York） | 加州时间（America/Los_Angeles） |
|---|---|
| 10:20 | 07:20 |
| 13:30 | 10:30 |

### 安装、检查和迁移系统任务

```sh
npm run jobs:native:install
npm run jobs:native:status
```

macOS 需要 Xcode Command Line Tools（Git/Swift 编译器）；缺少时先运行 `xcode-select --install` 并完成系统安装。安装器会编译一个很小的本机通知助手，在 `~/Library/LaunchAgents/` 注册用户级任务。首次请求 `CareerOps Notifier` 通知权限时选择允许。无需管理员常驻服务或模型 API Key。

这两个时间会按安装时系统时区转换成本地触发时间。纽约和加州的夏令时规则同步，全年保持三小时时差。移动到其他时区、或该地区与纽约夏令时切换日期不同后，请重新运行安装命令更新时刻。设置写在本机，不随 Git 或资料备份搬到新电脑；新电脑恢复资料后重新安装，旧电脑不再使用时卸载它的任务。

```sh
# 立即刷新一次：仅在确有新增候选时发通知。
npm run jobs:native:run

# 移除系统定时器，保留 profile、岗位记录与简历。
npm run jobs:native:uninstall
```

此前两项 Codex/Luna 定时任务已删除。不要再创建同时运行的 AI 导入任务；`career-ops-job-ingestion` skill 保留供手动调用、诊断或以后明确要求其他调度方式时使用。

系统任务是后台低优先级工作，没有 `KeepAlive`、轮询或登录时启动，也不主动唤醒或保持电脑唤醒。睡眠错过的日历触发会在唤醒后合并运行一次；关机错过的触发会等下个时段。详见 [Apple 的定时任务说明](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)。不需要保持 Codex 桌面应用打开。

### 通知、错误与用电

通知状态保存在 `data/lean/native-state.json`；通知失败的岗位保留为 pending，下次运行重试，不因去重而丢掉提醒。任务失败写入 `native-last-run.json` 和本机日志，不用错误弹窗打扰。点击新岗位通知会打开本地 shortlist；系统通知可能受专注模式、横幅设置影响，可用 status 命令检查权限。

一次实测：2252 个规范 URL 的完整联网刷新约 **0.91 秒**（另一次由系统启动为 **1.63 秒**），前一次累计 CPU 时间约 **0.40 秒**，峰值驻留内存约 **134 MiB**，退出后释放。该数据是本机一次测量，不是续航百分比，也不保证所有网络环境都一样。每日两次短运行不启动浏览器或本地大模型，预期额外耗电很低；token 是模型计费/用量指标，不能直接换算成本机耗电。保持电脑整天不睡眠反而没有必要。

该原生安装器目前仅支持 macOS；Linux/Windows 可由用户选择系统调度器运行同一本地 worker，但没有宣称其他系统已安装或验证。

## 模型与 token 预算

### 默认模型究竟是什么

| 环节 | 模型 / 推理设置 |
|---|---|
| 岗位拉取、解析、去重和硬条件代码 | **无模型，0 个模型 API token** |
| 两次系统任务的调度与通知 | **无模型，0 token**，由 launchd 和本机通知助手完成 |
| 新的可信仓库 Codex 会话、简历定制 | **gpt-6.1-sol / medium**，由 `.codex/config.toml` 指定 |
| HTML/PDF、事实/标题/一页检查、附件助手 | **无模型** |

本机修改前的全局配置为 Sol / xhigh；全局配置没有改动。已经打开的旧聊天、界面选择、CLI 覆盖或受管理策略可以覆盖仓库默认值。要显式启动同一设置：

```sh
codex -m gpt-6.1-sol -c model_reasoning_effort=medium
```

仅设置 `spend_tier: economy` 不会替你切换 Codex 当前模型。配置优先级见 [官方配置说明](https://learn.chatgpt.com/docs/config-file/config-basic)。日常导入不再需要 Luna；简历措辞与复杂要求保留 Sol，参考 [官方模型选择指南](https://developers.openai.com/api/docs/guides/model-selection)。

### 每天大约多少 token

**以下是预算估算，不是实测的每日账单。**项目文本按英文字符数约除以 4 估算；平台系统提示词、工具定义、历史和推理无法从仓库文件精确推出。

日常导入、去重、硬条件筛选、系统调度和本机通知均为 **0 模型 token**。自动投递启用后，Sol 核实 JD、定制简历和浏览器填写会产生模型用量；不限数量也意味着每日总用量不再有按岗位数的固定上限。导入仍为零模型。

简历估算假设：每次请求平台上下文 `H = 30,000` token；每日两次导入不调用模型；每个选中岗位平均 6 次模型请求；JD 2,000 token。遇到问题或返工时请求数会增加。

| 每天工作量 | 累计输入（含重复上下文） | 可见输出估计 | 额外推理预算 |
|---|---:|---:|---:|
| 仅两次系统岗位导入 | **0** | **0** | **0** |
| 导入 + 5 个选中岗位 | 约 106 万 | 2,500–12,500 | 1,500–15,000 |
| 导入 + 10 个选中岗位 | 约 212 万 | 5,000–25,000 | 3,000–30,000 |

不同 profile、JD、模型宿主和调用次数会改变数字，表内输入值保留约 ±25% 的规划区间；该区间不能保证覆盖所有长聊天或重试。**缓存输入不等于新增文本，API 账单、订阅配额和累计 token 也不能直接互换。**没有把安装开发过程的 token 冒充成每日导入实测。

可以按自己的工作量重新估算：

```sh
npm run tokens:estimate -- --jobs 5
node lean-token-budget.mjs --jobs 10 --host-tokens 30000 --calls-per-job 6 --calls-per-ingest 0
```

默认公式：每日模型输入约为 `岗位数 × 每岗模型请求数 × (H + profile/CV/规则/JD)`，系统导入部分为零。用实际 JD 会话的 usage 替换假设。旧长聊天可能携带大量历史；最好在项目的新会话中处理岗位并复用保存材料。

### 已落实的节省措施与质量边界

1. 仅载入简短的默认入口，上游的大型评估说明按明确请求才读取。
2. 岗位导入、系统调度和新岗位通知完全本地运行，无须任何模型读取数据。
3. 删除 AI 导入任务，使用不常驻、低优先级的系统日历任务。
4. 一个 JD 提取一次；失败就请求正文，不消耗模型操纵网页反复重试。
5. 复用已批准基稿，以 JSON patch 表达修改，减少重复输出；不重复生成 HTML/CSS。
6. PDF、字体、事实、标题、日期和页数由本地代码校验，不额外调用模型打分。
7. 人工登录和完成网页，助手只处理一次简历附件，不进行字段遍历。

这些措施不取消 source-of-truth 核对、不把未知 sponsor 当作通过，也不把不确定提交当作成功。模型与推理调整并未做双模型盲测，因此不宣称所有措辞质量完全相同；重要岗位可主动在 Sol 的更高推理档位处理，不需要增加评估流水线。

## 命令速查

| 任务 | 命令 |
|---|---|
| 初始化缺失的本地配置 | `npm run setup:lean` |
| 安装或刷新全局 skill | `npm run skills:install` |
| 虚构候选人离线示例 | `npm run demo` |
| 更新两个岗位来源 | `npm run jobs:ingest` |
| 不联网重建队列和清单 | `node lean-ingest.mjs` |
| 安装系统日历任务 | `npm run jobs:native:install` |
| 检查系统任务与通知 | `npm run jobs:native:status` |
| 立即运行并只通知新增 | `npm run jobs:native:run` |
| 卸载系统任务 | `npm run jobs:native:uninstall` |
| 预筛一个 job JSON | `node lean-prescreen.mjs data/lean/job.json` |
| 完整 payload 生成 PDF | `node lean-buildcv.mjs output/payload.json output/company-role` |
| 基稿 + patch 生成 PDF | `node lean-buildcv.mjs --base output/base-source.json --patch output/job.patch.json output/company-role` |
| Chromium 登录与一次附件 | `node lean-handoff.mjs --url URL --resume /absolute/output/cv.pdf --upload` |
| 导出私人资料 | `node lean-backup.mjs export local/private-backup.json` |
| 恢复私人资料 | `node lean-backup.mjs import /path/private-backup.json --overwrite` |
| token 预算估算 | `npm run tokens:estimate -- --jobs 5` |
| 精简流程与迁移测试 | `npm run test:lean` |

## 故障排查

| 现象 | 处理 |
|---|---|
| 找不到 Chromium / 缺少系统库 | 重跑与 lockfile 对应的浏览器安装命令；Linux 用 `--with-deps` |
| 新电脑找不到项目或 skill 指向旧路径 | 在新克隆目录重新安装 skill，或用 `--bind-skills` 指向现有全局目录 |
| 提示尚无 cv.md / profile | 恢复备份，或按真实资料填写；不要套用上游作者的 profile |
| 事实、标题或日期检查失败 | 回到事实来源核对；不使用跳过事实检查选项 |
| 简历超过一页 | 按 JD 删减低相关内容或重复句，保留必要事实，不缩小 11pt 正文 |
| 字体变化 / PDF 乱码 | 确认 `fonts/Vera*.ttf` 完整，使用锁定 Chromium；非拉丁文本需要另外选有相应字符集的字体 |
| submodule 有本地改动 | 先检查并保存改动；导入器不会强制覆盖源目录 |
| 新来源格式变了 / 拉取失败 | 保留现有队列，修复解析或网络后重跑；不要假装本次刷新成功 |
| sponsor 未说明 | `needs-review`；需要核实，不自动拒绝或通过 |
| 上传控件没识别出来 | 直接手动选择生成的 PDF；不要开启长时间网页填表循环 |
| 定时任务没运行 | 运行 `npm run jobs:native:status`，检查登录、开机、时间/时区、网络和目录权限；无需模型额度 |
| 有新增但没通知 | 检查 CareerOps Notifier 通知权限、专注模式和 native-state.json 中的 pending；记录不会因通知失败而丢弃 |

## 更新、验证与上游

更新这个 fork 使用正常 Git 流程，例如 `git pull --ff-only origin lean-workflow`，先处理自己的代码改动。私人资料不受 Git pull 管理；定期用导出命令保留备份。两个 submodule 的每日更新独立于程序更新。

本次验证包含：本地预筛与去重、实际源列表重复导入、Chromium 本地附件且不提交、迁移往返及凭证排除、基稿 patch、固定依赖安装、虚构候选人 PDF，以及私人资料在新目录恢复后重新生成单页 PDF。没有执行真实申请，也没有声称已完成跨操作系统实测或未来定时运行。

上游功能和说明保留在 [原版 README](docs/README_UPSTREAM.md) 与按需加载的上游规则中。此 fork 的默认用法以本 README 为准；其他原版语言 README 不代表本分支的精简流程。上游项目采用 MIT 许可证；字体附带自己的许可证。


## 持续自动投递与待答窗口

这是明确授权后才启用的模式；新的克隆默认关闭。流程定义在 `modes/continuous-apply.md`，可迁移的定时任务正文在 `modes/continuous-schedule.prompt.md`。

- **不限数量**：导入所有源记录，领取并处理所有符合条件的岗位，没有每日 3 份或每轮 10 份的上限。界面/日志的摘要长度不限制岗位发现或投递。宿主的时间、上下文、额度及人工接管仍可能中断一轮，下次从持久队列继续。
- **遇到不会的先跳过**：记录原题、选项和草稿，通过 dsh-omni 中继发到 QQ。本地回退窗口在 macOS 是置顶窗口；Windows/Linux 使用系统浏览器中的常驻页面。关闭窗口不会删除问题。浏览器登录、MFA、CAPTCHA 或用户接管可能暂停整轮浏览器操作，不能保证在接管期间仍能填写其他网站。
- **记住实际回答**：窗口回答自动保存；聊天里的明确回答由 agent 用 `answer --confirmed-by-user` 保存。默认只适用于该岗位，可以由用户选择扩大到同公司、同国家或全局。精确题目匹配、具体范围优先；offer 截止日期等时效信息必须设置失效日期。不会把一家公司的答案套到另一家。
- **防止重复**：原子领取避免并发重复。提交前保存意图，只尝试一次；有实际雇主确认才进入 Applied。提交阶段中断或迁移的岗位保留待核查状态，只有用户明确核实未提交后才能重新入队。
- **私人数据**：`data/lean/application-state.json` 包含答案、问题、草稿和确认记录，默认文件权限 0600，并已被 Git 忽略。密码和验证码不进入答案库。`review-runtime.json` 的本机端口、PID 和会话 token 不进入迁移备份。页面只监听 127.0.0.1，要求本机会话与同源写入，用户文字按文本显示。

### 第一次启用

先完成上面的安装、profile 和 `cv.md`，以及浏览器工具在本机的安装/登录。自动填写依赖宿主实际提供的浏览器工具；使用 ego-browser 时在新机安装对应 skill 和 ego-lite，再运行 `ego-browser skill` 验证。没有可用浏览器或安全登录方式时，保留待处理状态，不能声称已投递。

```sh
npm run skills:install
# macOS：编译通知与置顶窗口组件（需要 Xcode Command Line Tools）
npm run jobs:native:install
# 仅在你明确授权自动投递后执行
node lean-apply.mjs enable --confirmed-by-user
npm run apply:status
npm run apply:review
```

Linux/Windows 不运行 macOS 安装器；`apply:review` 使用系统浏览器，电脑需要图形桌面。macOS 未装原生组件时也可退回系统浏览器。置顶窗口是 macOS 的实际能力，不能把其他系统的浏览器页面称作已验证的置顶窗口。

在 Codex 桌面应用的 Scheduled 中创建**本地独立任务**，选择当前电脑上的项目，模型选 **gpt-6.1-sol / medium**，粘贴 `modes/continuous-schedule.prompt.md`。建议纽约时间每天 **13:40**，在 13:30 导入之后处理；可按需要增加运行时间，而不是增加岗位配额。电脑需开机、应用运行且可访问项目。该定时配置由应用管理，不能只复制仓库就宣称新电脑已经启用；新电脑应重新创建/验证 Scheduled。现有原生导入仍为 10:20 / 13:30，完全不调用模型。

打开待答窗口：`npm run apply:review`。关自动投递：`npm run apply:disable`，并在 Scheduled 暂停对应任务。查看状态：`npm run apply:status`。用户确认回答后，当前轮同步或下次定时运行会优先恢复该岗位。

### QQ 待答与资源回收

在 dsh-omni 控制台为 Career Ops 创建应用级令牌，保存到权限为 `0600` 的 `~/.config/dsh-omni/relay.json`。也支持 `DSH_OMNI_RELAY_TOKEN` 和 `DSH_OMNI_RELAY_URL`。本机默认地址为 `http://127.0.0.1:3100`，远程地址使用 HTTPS。新电脑单独配置令牌和网关地址。令牌文件位于仓库和迁移备份之外。

- `npm run apply:relay:status` 只读验证鉴权。
- `npm run apply:relay` 同步已有回复和未发送的问题。`npm run apply:relay -- --wait 25` 对一个待答请求长轮询一次，然后检查其余请求并退出。定时投递在开始和结束时同步，已排队的问题由 dsh-omni 依次送达。引用原消息或带 `#短码` 回复。
- QQ 不可用或问题未获回答时，待答事项保存在本地。关闭待答窗口后，后台最多空闲 30 秒即退出。事项全部处理完后，窗口等待 5 秒自动收起。展开已确认答案时可继续查看，点击「收起窗口并释放内存」即可释放。分页只限制窗口显示，岗位队列完整保留。
- 浏览器按需打开。投递运行结束后释放自己创建的页面，手动简历附件工具在关闭、异常和中断时回收浏览器上下文。

在私人 profile 的 `screening` 中开启 `exclude_citizen_only`、`exclude_green_card_only` 和 `exclude_security_clearance`，即可跳过有这些明确要求的岗位。必须能取得或维持 security clearance 也包含在内。

### 换电脑恢复与检查

1. 按“换电脑恢复原有资料”导出/导入私人备份。答案库、待答问题及投递状态在备份内；不要将备份提交到 Git。
2. 在新克隆目录重装依赖、Chromium 和 skills；macOS 重新运行 `jobs:native:install`，生成这台电脑的路径与通知组件。不要复制旧机器的 `local/`、LaunchAgent、端口/PID、浏览器 cookies 或凭证。
3. 重新登录所需浏览器和邮箱，检查身份；重新建立上面的本地 Scheduled 任务。所有代码通过 checkout、skill 绑定和 data-root resolver 找目录，没有个人用户名或固定安装目录。
4. 运行 `npm run test:lean`、`npm run apply:status` 和 `npm run apply:review`。检查待答问题与答案范围。迁移时处于 working/submitting 的申请会变为 uncertain，先核对雇主结果，不能直接重复提交。

核心回归使用虚构资料验证不限数量、并发去重、跳过未知问题、精确范围/失效日期、真实浏览器保存回答、网页注入防护、提交证据门槛及不同目录迁移。自动化测试不向雇主真实投递。macOS 原生窗口与通知安装需本机验证；Windows/Linux 的启动适配有测试，未宣称已经在实体 Windows/Linux 机器完成实测。
