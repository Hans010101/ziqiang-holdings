# Cloudflare 002 迁移记录

日期：2026-10-10（Asia/Shanghai）

## 目标资源

- 账号：`a828bebda1f352216c7d7da425bad17a`（`hans.pan002@gmail.com`）
- Worker：`ziqiang-holdings`
- 入口：<https://ziqiang-holdings.bitman001.workers.dev>
- D1：`ziqiang-holdings-db`（`cba3bce5-ee5a-4178-a5e3-822ae7e1d792`）
- Cron：`17 * * * *`
- Secret：`SYNC_SECRET`（仅核验名称和绑定，未读取值）
- 发布版本：`942034a6-c9ee-47ae-9203-472e55cf50e0`

## 验收结果

- 002 入口直接提供首页、机构详情、历史申报、港股/A 股披露、CSV 导出与 RSS，不经过 007。
- 目标 D1 有 38 家机构、391 份申报、289,178 条 13F/ARK 持仓、12 份港股/A 股官方披露和 25 条权益记录；外键检查无错误。
- 段永平关联的泡泡玛特法定权益披露已保留：102,576,000 股、7.70%，来源为香港交易所权益披露。
- SEC/ARK/Nasdaq 定时采集代码使用 002 D1；港股和 A 股是逐份核验后入库的官方披露快照，不是自动全市场采集。
- 仓库配置、公开入口和 SEC 联系身份均已切换到 002；完整类型检查、17 项测试及 Wrangler dry-run 通过。
- 002 控制台已激活 `17 * * * *` 定时触发器；由于新部署的 Cron 传播最多需 30 分钟，2026-10-10 01:17（Asia/Shanghai）未触发，控制台显示首个后续时点为 02:17。定时配置已核验，首次实际运行结果尚待该时点确认。

## 007 备份与剩余边界

- 007 Worker 保留为 thin bridge，Cron 为空；007 D1 保留且未删除、清空或覆盖。
- GitHub 仓库为公开仓库，发布配置已固定到 002；仓库目前没有 GitHub Actions 工作流或专用 Cloudflare Secret，自动 CI 发布仍需单独配置 002 专用 Token。手动 Wrangler 发布不依赖 007。
