CREATE TABLE regulatory_disclosures (
  id TEXT PRIMARY KEY,
  manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  issuer TEXT NOT NULL,
  name_cn TEXT NOT NULL,
  ticker TEXT NOT NULL,
  position_type TEXT NOT NULL CHECK (position_type IN ('好仓', '淡仓')),
  shares REAL NOT NULL,
  ownership_percent REAL NOT NULL,
  involved_shares REAL NOT NULL DEFAULT 0,
  reason_code TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_regulatory_disclosures_manager_date ON regulatory_disclosures(manager_id, event_date DESC, filed_date DESC);

INSERT INTO regulatory_disclosures
  (id,manager_id,market,issuer,name_cn,ticker,position_type,shares,ownership_percent,involved_shares,reason_code,event_date,filed_date,source_name,source_url)
VALUES
  ('CS20260812E00001','hh','香港交易所','Pop Mart International Group Ltd.','泡泡玛特','09992','好仓',102576000,7.70,28646000,'11032','2026-08-06','2026-08-12','香港交易所权益披露','https://di.hkex.com.hk/di/NSForm2.aspx?fn=CS20260812E00001&sid=312028&lang=ZH&src=MAIN');
