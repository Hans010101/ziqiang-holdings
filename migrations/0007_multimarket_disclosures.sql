DROP TABLE regulatory_disclosures;

CREATE TABLE disclosure_documents (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL CHECK (market IN ('港股', 'A股')),
  document_type TEXT NOT NULL,
  coverage_scope TEXT NOT NULL CHECK (coverage_scope IN ('threshold_interest_event', 'top10_shareholders')),
  issuer TEXT NOT NULL,
  name_cn TEXT NOT NULL,
  ticker TEXT NOT NULL,
  report_date TEXT,
  event_date TEXT,
  filed_date TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_level TEXT NOT NULL CHECK (source_level = 'statutory_primary'),
  validation_status TEXT NOT NULL CHECK (validation_status = 'verified'),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (coverage_scope = 'threshold_interest_event' AND event_date IS NOT NULL)
    OR (coverage_scope = 'top10_shareholders' AND report_date IS NOT NULL)
  )
);

CREATE TABLE ownership_rows (
  document_id TEXT NOT NULL REFERENCES disclosure_documents(id) ON DELETE CASCADE,
  manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL,
  holder_name_raw TEXT NOT NULL,
  holder_name_cn TEXT NOT NULL DEFAULT '',
  rank INTEGER,
  share_class TEXT NOT NULL,
  position_side TEXT NOT NULL CHECK (position_side IN ('好仓', '淡仓', '普通股')),
  shares_after REAL NOT NULL,
  percent_after REAL,
  shares_before REAL,
  percent_before REAL,
  event_shares REAL,
  reason_code TEXT NOT NULL DEFAULT '',
  denominator_scope TEXT CHECK (denominator_scope IN ('total_issued', 'issued_share_class', 'unrestricted')),
  quantity_basis TEXT NOT NULL CHECK (quantity_basis = 'official_direct'),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (document_id, holder_name_raw, position_side)
);

CREATE INDEX idx_disclosure_documents_market_date ON disclosure_documents(market, filed_date DESC);
CREATE INDEX idx_ownership_rows_manager ON ownership_rows(manager_id);

INSERT INTO disclosure_documents
  (id,market,document_type,coverage_scope,issuer,name_cn,ticker,report_date,event_date,filed_date,source_name,source_url,source_level,validation_status,note)
VALUES
  ('HKEX-IS20260812E00002','港股','个人权益披露通知','threshold_interest_event','Pop Mart International Group Ltd.','泡泡玛特','09992',NULL,'2026-08-06','2026-08-12','香港交易所权益披露','https://di.hkex.com.hk/','statutory_primary','verified','单一上市公司的门槛触发权益事件；同一权益链的公司通知 CS20260812E00001 不重复计数。'),
  ('HKEX-CS20260822E00028','港股','大股东权益披露通知','threshold_interest_event','SITC International Holdings Co. Ltd.','海丰国际','01308',NULL,'2026-08-19','2026-08-22','香港交易所权益披露','https://di.hkex.com.hk/','statutory_primary','verified','证券借贷召回导致权益性质变化，法定好仓及淡仓数量未变。'),
  ('HKEX-CS20260811E00468','港股','大股东权益披露通知','threshold_interest_event','Sunny Optical Technology (Group) Co. Ltd.','舜宇光学科技','02382',NULL,'2026-08-06','2026-08-11','香港交易所权益披露','https://di.hkex.com.hk/','statutory_primary','verified','证券借贷相关权益事件，不直接定性为买入。'),
  ('HKEX-CS20260812E00266','港股','大股东权益披露通知','threshold_interest_event','SICC Co., Ltd. - H Shares','天岳先进','02631',NULL,'2026-08-07','2026-08-12','香港交易所权益披露','https://di.hkex.com.hk/','statutory_primary','verified','同一控制链仅保留最高层Point72记录，关联表单不重复相加。'),
  ('HKEX-CS20260812E00424','港股','大股东权益披露通知','threshold_interest_event','WuXi AppTec Co., Ltd. - H Shares','药明康德','02359',NULL,'2026-08-07','2026-08-12','香港交易所权益披露','https://di.hkex.com.hk/','statutory_primary','verified','部分股份转为借出，法定好仓总数未变，不直接定性为交易。'),
  ('HKEX-CS20260812E00052','港股','大股东权益披露通知','threshold_interest_event','Xiaomi Corporation - W','小米集团-W','01810',NULL,'2026-08-07','2026-08-12','香港交易所权益披露','https://di.hkex.com.hk/','statutory_primary','verified','证券借贷召回导致权益性质变化，法定好仓及淡仓数量未变。'),
  ('HKEX-CS20260812E00306','港股','大股东权益披露通知','threshold_interest_event','CMOC Group Ltd. - H Shares','洛阳钼业','03993',NULL,'2026-08-07','2026-08-12','香港交易所权益披露','https://di.hkex.com.hk/','statutory_primary','verified','认可借出代理人的借股池比例变化，不直接定性为买入。'),
  ('CNINFO-1224768523','港股','上市公司三季度报告','top10_shareholders','江苏宁沪高速公路股份有限公司','宁沪高速','00177','2025-09-30',NULL,'2025-10-30','巨潮资讯上市公司定期报告','https://static.cninfo.com.cn/finalpage/2025-10-30/1224768523.PDF','statutory_primary','verified','发行人前十名股东快照；这些记录均为境外上市外资股（H股），不是A股。'),
  ('CNINFO-1225479797','A股','上市公司半年度报告','top10_shareholders','深圳市沃特新材料股份有限公司','沃特股份','002886','2026-06-30',NULL,'2026-08-19','巨潮资讯上市公司定期报告','https://static.cninfo.com.cn/finalpage/2026-08-19/1225479797.PDF','statutory_primary','verified','发行人前十名股东快照，不代表任一机构的完整A股组合。'),
  ('CNINFO-1225517874','A股','上市公司半年度报告','top10_shareholders','青岛国林科技集团股份有限公司','国林科技','300786','2026-06-30',NULL,'2026-08-28','巨潮资讯上市公司定期报告','https://static.cninfo.com.cn/finalpage/2026-08-28/1225517874.PDF','statutory_primary','verified','发行人前十名股东快照；仅录入报告直接披露的股数，不反推未明确列出的比例。'),
  ('CNINFO-1225478600','A股','上市公司半年度报告','top10_shareholders','多氟多新材料股份有限公司','多氟多','002407','2026-06-30',NULL,'2026-08-18','巨潮资讯上市公司定期报告','https://static.cninfo.com.cn/finalpage/2026-08-18/1225478600.PDF','statutory_primary','verified','发行人前十名股东快照，不代表任一机构的完整A股组合。'),
  ('CNINFO-1225463226','A股','上市公司半年度报告','top10_shareholders','深圳市朗科科技股份有限公司','朗科科技','300042','2026-06-30',NULL,'2026-08-08','巨潮资讯上市公司定期报告','https://static.cninfo.com.cn/finalpage/2026-08-08/1225463226.PDF','statutory_primary','verified','发行人前十名股东快照，不代表任一机构的完整A股组合。');

INSERT INTO ownership_rows
  (document_id,manager_id,holder_name_raw,holder_name_cn,share_class,position_side,shares_after,percent_after,shares_before,percent_before,event_shares,reason_code,denominator_scope,quantity_basis,note)
VALUES
  ('HKEX-IS20260812E00002','hh','Duan Yong Ping','段永平（经H&H International Investment, LLC）','普通股','好仓',102576000,7.70,73930000,5.55,28646000,'11032','issued_share_class','official_direct','本次变化涉及承担交付标的股份义务的股权衍生工具；法定好仓不等同现货股票或实时仓位。'),
  ('HKEX-CS20260822E00028','blackrock','BlackRock, Inc.','贝莱德','普通股','好仓',137489300,5.07,137489300,5.07,419000,'1314','total_issued','official_direct','权益性质变化，数量未变；同份通知另披露淡仓。'),
  ('HKEX-CS20260822E00028','blackrock','BlackRock, Inc.','贝莱德','普通股','淡仓',5458000,0.20,5458000,0.20,NULL,'1314','total_issued','official_direct','与同份好仓记录分开展示，不相减为净持仓。'),
  ('HKEX-CS20260811E00468','ubs','UBS Group AG','瑞银集团','普通股','好仓',66550229,6.08,64138446,5.86,2411783,'1113','issued_share_class','official_direct','借股及证券借贷相关变化，不直接定性为买入。'),
  ('HKEX-CS20260811E00468','ubs','UBS Group AG','瑞银集团','普通股','淡仓',69174161,6.32,69174161,6.32,NULL,'1113','issued_share_class','official_direct','与同份好仓记录分开展示，不相减为净持仓。'),
  ('HKEX-CS20260812E00266','point72','Point72 Asset Management, L.P.','第七十二点资产管理','H股','好仓',3298400,6.01,2824000,5.14,474400,'1101','issued_share_class','official_direct','购入474,400股，最高价HKD73.90、均价HKD71.5128；同一控制链不重复相加。'),
  ('HKEX-CS20260812E00424','fidelity','FMR LLC','富达 / FMR','H股','好仓',46030729,9.02,46030729,9.02,60007,'1313','issued_share_class','official_direct','60,007股转为借出，法定好仓总数未变。'),
  ('HKEX-CS20260812E00052','blackrock','BlackRock, Inc.','贝莱德','普通股','好仓',1072123822,5.01,1072123822,5.01,5993195,'1314','issued_share_class','official_direct','证券借贷召回导致权益性质变化，数量未变。'),
  ('HKEX-CS20260812E00052','blackrock','BlackRock, Inc.','贝莱德','普通股','淡仓',24927000,0.12,24927000,0.12,NULL,'1314','issued_share_class','official_direct','与同份好仓记录分开展示，不相减为净持仓。'),
  ('HKEX-CS20260812E00306','jpmorgan','JPMorgan Chase & Co.','摩根大通','H股','好仓',236089220,6.00,219717283,5.58,16371937,'16021','issued_share_class','official_direct','借股池比例变化；其中借股仓由93,534,689股升至108,623,934股。'),
  ('HKEX-CS20260812E00306','jpmorgan','JPMorgan Chase & Co.','摩根大通','H股','淡仓',63952345,1.62,63718191,1.61,NULL,'16021','issued_share_class','official_direct','淡仓前后数量均为原文直接值；不把差额冒充表单披露的涉及股数。'),
  ('CNINFO-1224768523','blackrock','BlackRock, Inc.','贝莱德','境外上市外资股（H股）','普通股',125512542,2.49,NULL,NULL,NULL,'','total_issued','official_direct','2025年第三季度末发行人前十名股东快照。'),
  ('CNINFO-1224768523','jpmorgan','JPMorgan Chase & Co.','摩根大通','境外上市外资股（H股）','普通股',71686325,1.42,NULL,NULL,NULL,'','total_issued','official_direct','2025年第三季度末发行人前十名股东快照。'),
  ('CNINFO-1224768523','state-street','State Street Corporation','道富','境外上市外资股（H股）','普通股',66234148,1.31,NULL,NULL,NULL,'','total_issued','official_direct','2025年第三季度末发行人前十名股东快照。'),
  ('CNINFO-1225479797','goldman-sachs','高盛国际－自有资金','高盛国际','人民币普通股','普通股',1424405,0.54,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225479797','ubs','UBS AG','瑞银','人民币普通股','普通股',1414484,0.54,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225517874','goldman-sachs','高盛国际－自有资金','高盛国际','人民币普通股','普通股',3325041,1.81,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225517874','morgan-stanley','MORGAN STANLEY & CO. INTERNATIONAL PLC.','摩根士丹利国际','人民币普通股','普通股',1865704,1.01,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225517874','ubs','UBS AG','瑞银','人民币普通股','普通股',1631066,0.89,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225517874',NULL,'MERRILL LYNCH INTERNATIONAL','美林国际','人民币普通股','普通股',1123708,0.61,NULL,NULL,NULL,'','total_issued','official_direct','未在缺少关系证明时自动并入美国银行组合。'),
  ('CNINFO-1225517874','jpmorgan','J.P.Morgan Securities PLC－自有资金','摩根大通证券','人民币普通股','普通股',1096082,0.60,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225478600','ubs','UBS AG','瑞银','人民币普通股','普通股',7421029,0.62,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225478600','goldman-sachs','高盛国际－自有资金','高盛国际','人民币普通股','普通股',7360757,0.62,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225463226','ubs','UBS AG','瑞银','人民币普通股','普通股',1144603,0.57,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。'),
  ('CNINFO-1225463226','morgan-stanley','MORGAN STANLEY & CO. INTERNATIONAL PLC.','摩根士丹利国际','人民币普通股','普通股',1027064,0.51,NULL,NULL,NULL,'','total_issued','official_direct','2026年半年度末发行人前十名股东快照。');

UPDATE managers SET data_note='13F通常不覆盖港交所本地股票；港股法定权益事件在独立栏目展示，不与13F组合规模、集中度或机构共识合并。' WHERE id='hh';
