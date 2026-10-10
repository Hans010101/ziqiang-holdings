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
- 002 的 `17 * * * *` 定时任务已真实且连续运行：目标 D1 从 UTC 2026-10-09 18:17:52 到 23:17:52 连续新增 6 次 `success` 记录，每次均有 38 家机构与证券元数据共 39 个成功项、无错误，平均耗时 32.8 秒。最新一轮于北京时间 2026-10-10 07:17:52 开始，07:18:22 结束；线上 `/api/summary` 和 `/api/sources` 均已显示该轮结果。Cloudflare 线上调度查询同时确认 Cron 为 `17 * * * *`，可排除仅有配置、没有执行的情况。

## 007 备份与剩余边界

- 007 Worker 保留为 thin bridge，Cron 为空；007 D1 保留且未删除、清空或覆盖。
- 目标 D1 中迁移前遗留的 6 条孤立 `running` 记录仍保留；最新状态与公开页面不受影响，本次只读验收未清理历史记录。
- GitHub 仓库为公开仓库，发布配置中的账号、D1、入口和 SEC 联系身份均已固定到 002，不存在回退到 007 的仓库依赖；仓库目前没有 GitHub Actions 工作流或专用 Cloudflare Secret。
- 当前机器的 Wrangler `default` profile 仍登录 007，且没有 002 profile；因此从这个终端再次手动发布前，必须切换到 002 OAuth 或提供 002 专用 Token。显式的 002 `account_id` 会使错误账号授权直接失败，不会把新版本误发到 007。
