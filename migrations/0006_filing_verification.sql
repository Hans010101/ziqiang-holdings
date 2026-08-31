ALTER TABLE filings ADD COLUMN declared_positions_count INTEGER;
ALTER TABLE filings ADD COLUMN declared_total_value INTEGER;
ALTER TABLE filings ADD COLUMN declared_raw_total_value INTEGER;
ALTER TABLE filings ADD COLUMN value_multiplier INTEGER NOT NULL DEFAULT 1;
ALTER TABLE filings ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE filings ADD COLUMN validation_detail TEXT NOT NULL DEFAULT '';
ALTER TABLE filings ADD COLUMN contributing_accessions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE filings ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE filings ADD COLUMN fetched_at TEXT;

ALTER TABLE managers ADD COLUMN data_note TEXT NOT NULL DEFAULT '';

ALTER TABLE positions RENAME TO positions_legacy;

CREATE TABLE positions (
  filing_id TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  cusip TEXT NOT NULL,
  issuer TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  ticker TEXT NOT NULL DEFAULT '',
  shares REAL NOT NULL DEFAULT 0,
  amount_type TEXT NOT NULL DEFAULT 'SH',
  value INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  put_call TEXT NOT NULL DEFAULT '',
  discretion TEXT NOT NULL DEFAULT '',
  sole REAL NOT NULL DEFAULT 0,
  shared REAL NOT NULL DEFAULT 0,
  none_votes REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (filing_id, cusip, title, put_call, amount_type)
);

INSERT INTO positions (filing_id,cusip,issuer,title,ticker,shares,value,weight,put_call,discretion,sole,shared,none_votes)
SELECT filing_id,cusip,issuer,title,ticker,shares,value,weight,put_call,discretion,sole,shared,none_votes FROM positions_legacy;

DROP TABLE positions_legacy;

CREATE INDEX idx_positions_filing_value ON positions(filing_id, value DESC);
CREATE INDEX idx_positions_cusip ON positions(cusip);
CREATE INDEX idx_positions_issuer ON positions(issuer);

CREATE TABLE filing_notices (
  id TEXT PRIMARY KEY,
  manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  form TEXT NOT NULL,
  source_url TEXT NOT NULL,
  other_managers TEXT NOT NULL DEFAULT '[]',
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_filing_notices_manager_date ON filing_notices(manager_id, report_date DESC, filed_date DESC);

UPDATE filings SET validation_status='legacy',validation_detail='历史快照尚未完成封面与证券类型复核。';
UPDATE filings SET validation_status='pending'
WHERE (manager_id,report_date) IN (
  SELECT manager_id,report_date FROM (
    SELECT manager_id,report_date,DENSE_RANK() OVER (PARTITION BY manager_id ORDER BY report_date DESC) report_rank
    FROM filings GROUP BY manager_id,report_date
  ) WHERE report_rank<=2
);

DELETE FROM positions WHERE filing_id IN (SELECT id FROM filings WHERE manager_id IN ('greenlight','pershing-square'));
DELETE FROM filings WHERE manager_id IN ('greenlight','pershing-square');

UPDATE managers SET
  cik='0001489933',
  name='DME Capital Management, LP',
  display_name='大卫·艾因霍恩 / DME Capital',
  source_url='https://www.sec.gov/edgar/browse/?CIK=1489933',
  data_note='当前官方持仓由 DME Capital Management 申报；旧 Greenlight 申报主体不参与跨期比较。'
WHERE id='greenlight';

UPDATE managers SET
  cik='0002026053',
  name='Pershing Square Inc.',
  display_name='比尔·阿克曼 / Pershing Square',
  source_url='https://www.sec.gov/edgar/browse/?CIK=2026053',
  data_note='2026 年第二季度起，官方持仓由 Pershing Square Inc. 申报；旧主体不参与跨期比较。'
WHERE id='pershing-square';

UPDATE managers SET data_note='最新官方文件为 13F-NT，持仓已转由所列关联申报主体分别披露；历史组合不再作为当前持仓。' WHERE id='vanguard';
UPDATE managers SET data_note='公开申报截至 2025 年第三季度；未发现更晚 13F，不把历史组合当作当前仓位。' WHERE id='scion';
UPDATE managers SET data_note='13F 通常不覆盖港交所本地股票；未出现在 13F 中不等于未持有。香港交易所数据须取得再分发授权后才能接入。' WHERE id='hh';

DELETE FROM regulatory_disclosures;
