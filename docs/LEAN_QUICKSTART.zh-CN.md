# 精简版 career-ops 快速入口

完整说明统一维护在主 [README](../README.md)，包括全新电脑安装、私人资料迁移、每日 10:20 / 13:30 纽约时间导入、模型设置和 token 预算。

```sh
git clone --branch lean-workflow --depth 1 --recurse-submodules --shallow-submodules https://github.com/dogeheng/career-ops.git
cd career-ops
npm ci --ignore-scripts
npx playwright install chromium
node lean-setup.mjs
node lean-setup.mjs --install-skills
npm run demo
```

使用仓库 `.nvmrc` 中的 Node 版本。恢复旧电脑资料后，可直接在 Codex 使用 `$career-ops` 加 JD，或 `$career-ops-job-ingestion` 更新岗位。最终 Submit 仍由你操作。
