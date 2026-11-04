# 精简版 career-ops

这个 fork 使用：**pre-screen → buildcv → Chromium 登录 → 上传简历 → 你手动完成并提交**。没有 A–H eval、匹配评分、公司调研、求职信或多 agent 批评步骤。PDF 事实、标题、排序和页数检查仍由本地代码执行。

## 安装

```sh
git clone --recurse-submodules --branch lean-workflow https://github.com/dogeheng/career-ops.git
cd career-ops
npm install
node lean-setup.mjs
```

在 `config/profile.yml` 填写已确认资料，把真实履历存为 `cv.md`。`modes/_custom.md` 保存流程偏好，来源模板为 `modes/lean-custom.template.md`。它们与生成材料、登录会话和岗位队列全部忽略提交。不要把个人资料上传到公开 fork。用正常 Git 同步这个分支；上游 updater 会覆盖 fork 的系统代码，因此不在本 fork 运行。

## 使用

在这个目录打开 Codex 或 Claude Code，直接说：

> 用 career-ops 精简流程处理这个 JD：……。先筛硬性条件，通过后按 JD 生成英文简历；有不确定的先问我。

或说：

> 刷新 new grad 岗位，优先给我看新的美国岗位。

原来的 `auto-pipeline`、`pipeline`、`pdf`、`buildcv`、`apply` 入口在 `pipeline.mode: lean` 时同样进入精简流程，不会先加载上游评估提示词。其他工具仍可按需单独调用。

硬条件使用 `screening`：`full_time_years` 不含实习，`work_authorization` 和 `future_sponsorship_required` 按国家填写，日期为 YYYY-MM-DD，国家为 ISO 两位代码。未知填 `null`；不允许通过空值推断不需要 sponsor。明确的专业全职年限和不提供 sponsor 条件可以跳过；preferred、学位替代、实习是否计入或未说明 sponsor 保留待确认。岗位库元数据不等于完整 JD 或仍在招聘的证明。

`cv.show_location: false` 隐去简历页眉所在地；需要显示时只能填写真实地点。`cv.projects: auto` 由 agent 从 `cv.md` 按 JD 选择项目；`omit` 不显示项目；名称列表只允许选中的项目。

## 本地命令

```sh
node lean-ingest.mjs --refresh
node lean-prescreen.mjs data/lean/job.json
node lean-buildcv.mjs output/tailored.json output/company-role
node lean-handoff.mjs --url https://employer.example/application --resume /absolute/path/to/output/company-role.pdf --upload
```

`job.json` 至少包含 `{url,company,title,country,text,metadata_only:false}`。明确且经人工解读确认的条件还可写 `min_experience_years`（必需全职年限）、`requires_existing_authorization`、`sponsorship: no|yes|unknown`、`graduation_from`、`graduation_to`、`latest_start_date`、`citizenship: US`。脚本不声称全面理解自然语言；agent 仍需用一次 JD 阅读补充学位、专业和复杂替代要求，无法确定就问。

`buildcv` 接收 agent 根据 JD 和事实库生成的紧凑 JSON；HTML/PDF 由已有 renderer 生成，不调用额外模型。输出路径必须在数据根的 `output/` 下。每份 PDF 检查一次版式。

Chromium 使用专用本地 profile，登录可跨次复用。你手动登录和处理 MFA/CAPTCHA。`--upload` 只对指定雇主域名授权一次简历附件，最多等十分钟；找到一个明确标为 Resume/CV 的文件框才上传。多个输入框、非标准控件或跳转到另一域名时手动上传，或用最终域名重开。上传只表示文件被放进输入框，需要在网页确认成功；填写问题、下拉选择和 Submit 都交给你。关闭窗口结束助手。没有 Playwright MCP 填表循环。

## 每日导入

`$career-ops-job-ingestion` 调用本地脚本，更新两个公开 submodule（使用 HTTPS，无需 SSH 私钥）：SpeedyApply `main` 的美国/国际 new grad 文件，Simplify `dev` 的 README。只解析公开内容，不运行源仓库脚本。不导入 internship 列表，不逐岗位调用模型或打开浏览器。

输出 `data/lean/jobs.json`、`shortlist.md`、`last-run.json`。按规范 URL 去重，已跟踪的链接不进入待投清单；再次运行不会重复创建。源列表消失只标为未列出，不假装岗位已经关闭。已有状态会保留。每日自动化读取这个 skill；时间由 Codex 自动化设置管理。

## 验证

```sh
node --test tests/lean-workflow.test.mjs
```

覆盖硬条件、未知值、学位替代、两种来源格式、去重、重复运行与无提交上传边界。真实站点的登录、CAPTCHA、附件控件和提交结果需要逐站确认；安装过程不执行真实申请。
