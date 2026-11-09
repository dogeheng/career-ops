使用 $career-ops 执行用户已明确授权的持续自动投递。通过 skill 的 installation.json 或项目目录定位当前 checkout，使用 path-resolver.mjs 解析私人数据目录；不要依赖旧聊天或旧电脑的绝对路径。阅读 modes/continuous-apply.md，确认 lean-apply.mjs status 已启用，按其中流程工作。

用户授权：对符合真实 profile 的岗位核实 JD、使用 Sol 定制真实一页简历、填写已确认事实并直接提交；不设置发现岗位、每轮或每天的投递数量上限。优先美国 full-time new grad / entry-level；其他地区遵守已确认的 profile 筛选。不得凑数、猜测 sponsor、毕业/入职条件、身份或必填事实。显式不匹配跳过，不确定的岗位保存草稿和问题，调用 lean-apply.mjs block 通过 QQ 提问，继续其他岗位。用户回答后按准确问题、适用范围及失效日期记入私人答案库；不得存密码或验证码。

使用 next 每次原子领取一个岗位，重复处理所有待办直到当前队列已处理、任务被用户停止或宿主达到运行限制；不存在“三份”等人为数量上限。已提交、等待回答和结果不明的岗位不得重复申请。保持本地导入为零模型脚本，不跑 eval、评分报告、多模型复审或额外 agent。仅在实际需要时读取 JD 和简历；遵循浏览器工具的权限、登录和接管规则。遇到自动审批拒绝按要求报告，不得绕过；其他独立岗位能继续则继续。

提交前记录 submit-intent，只点击一次 Submit；有雇主确认才记 submitted，并通过 canonical tracker writer 标记 Applied。超时或断线标记 uncertain，交给待答窗口核查。不要自动重试。每次结束用中文报告实际提交数量及公司/岗位、待答问题、结果不明项和剩余工作；不要把上传算作投递，不要宣称没有实测的 ATS 均可自动完成。

手动事实问题走 dsh-omni QQ 中继。按持续投递流程在领取岗位前及本轮结束前同步回复，排队的提问交给中继投递，窗口仅用于本机待答回退。每个岗位结束后释放该次申请使用的浏览器页面。

无人值守时用页面结构和文字核验，保存确认文本、链接和申请编号。跳过截图、录屏和 CDP 画面采集。ego-browser 成功收尾时调用 task.finish({ keep: [] })。macOS 上检查 pmset -g assertions，若仍有 ego lite 的 Capturing 断言，按持续投递流程释放。
