# 点金雷达

白底红色品牌风格的公开持仓研究平台，追踪段永平关联机构、巴菲特、木头姐、知名主动基金、量化机构和大型金融机构。

线上地址：[ziqiang-holdings.hans-pan007.workers.dev](https://ziqiang-holdings.hans-pan007.workers.dev)

## 功能

- 首页：数据驾驶舱、机构共识、最新申报与总体数据
- 机构：组合规模、集中度、Top 持仓、相邻报告期股数变化和历史趋势
- 股票：按 CUSIP 聚合最新机构共识，支持板块与行业筛选
- 对比：同时比较 2–5 家机构及重合持仓
- 搜索与导出：机构 / 股票搜索、机构分类筛选、CSV 导出
- 提醒：公开 RSS feed；Cloudflare Cron 每小时检查源站更新

## 数据源与口径

- [SEC EDGAR](https://www.sec.gov/edgar/sec-api-documentation)：13F-HR / 13F-HR/A 官方 XML
- [ARK Invest](https://www.ark-funds.com/download-fund-materials)：六只主动 ETF 官方日频 CSV
- [Nasdaq Stock Screener](https://www.nasdaq.com/market-activity/stocks/screener)：补充可靠匹配的 ticker、板块与行业，未匹配项保持空白
- 增减持按相邻报告期的**披露股数**计算，不按市值变化推断交易
- 13F 最长滞后 45 天，不包含空头、现金和多数非美国交易证券；公司行动影响无法排除时应理解为“披露持股变化”

## 本地开发

```bash
npm install
npx wrangler d1 migrations apply ziqiang-holdings-db --local
npx wrangler types
npm run dev
```

创建 `.dev.vars` 并设置 `SYNC_SECRET`，随后可手动同步：

```bash
curl -X POST -H "Authorization: Bearer $SYNC_SECRET" 'http://localhost:8787/api/sync?manager=berkshire&limit=2'
```

## 验证与部署

```bash
npm run check
npm run deploy
```

线上 D1 迁移：`npx wrangler d1 migrations apply ziqiang-holdings-db --remote`。

## 技术栈

Cloudflare Worker + D1 + Static Assets，前端使用原生 HTML / CSS / JavaScript，无运行时第三方依赖。

## 许可

MIT
