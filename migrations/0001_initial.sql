PRAGMA foreign_keys = ON;

CREATE TABLE managers (
  id TEXT PRIMARY KEY,
  cik TEXT UNIQUE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('SEC', 'ARK')),
  source_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sync_depth INTEGER NOT NULL DEFAULT 2,
  last_synced_at TEXT
);

CREATE TABLE filings (
  id TEXT PRIMARY KEY,
  manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  form TEXT NOT NULL,
  source_url TEXT NOT NULL,
  total_value INTEGER NOT NULL DEFAULT 0,
  positions_count INTEGER NOT NULL DEFAULT 0,
  is_amendment INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE positions (
  filing_id TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  cusip TEXT NOT NULL,
  issuer TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  ticker TEXT NOT NULL DEFAULT '',
  shares REAL NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  put_call TEXT NOT NULL DEFAULT '',
  discretion TEXT NOT NULL DEFAULT '',
  sole REAL NOT NULL DEFAULT 0,
  shared REAL NOT NULL DEFAULT 0,
  none_votes REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (filing_id, cusip, title, put_call)
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_filings_manager_date ON filings(manager_id, report_date DESC, filed_date DESC);
CREATE INDEX idx_positions_filing_value ON positions(filing_id, value DESC);
CREATE INDEX idx_positions_cusip ON positions(cusip);
CREATE INDEX idx_positions_issuer ON positions(issuer);

INSERT INTO managers (id, cik, name, display_name, category, source, source_url, sync_depth) VALUES
('hh', '0001759760', 'H&H International Investment, LLC', '段永平关联 / H&H', '知名投资人', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1759760', 20),
('berkshire', '0001067983', 'Berkshire Hathaway Inc', '巴菲特 / Berkshire', '知名投资人', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1067983', 20),
('bridgewater', '0001350694', 'Bridgewater Associates, LP', 'Bridgewater', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1350694', 8),
('pershing-square', '0001336528', 'Pershing Square Capital Management, L.P.', 'Pershing Square', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1336528', 12),
('appaloosa', '0001656456', 'Appaloosa LP', 'Appaloosa', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1656456', 8),
('baupost', '0001061768', 'Baupost Group LLC', 'Baupost Group', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1061768', 8),
('third-point', '0001040273', 'Third Point LLC', 'Third Point', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1040273', 8),
('soros', '0001029160', 'Soros Fund Management LLC', 'Soros Fund', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1029160', 8),
('scion', '0001649339', 'Scion Asset Management, LLC', 'Michael Burry / Scion', '知名投资人', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1649339', 12),
('greenlight', '0001079114', 'Greenlight Capital Inc', 'Greenlight Capital', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1079114', 8),
('icahn', '0000921669', 'Icahn Carl C', 'Carl Icahn', '知名投资人', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=921669', 8),
('tiger-global', '0001167483', 'Tiger Global Management LLC', 'Tiger Global', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1167483', 8),
('lone-pine', '0001061165', 'Lone Pine Capital LLC', 'Lone Pine', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1061165', 8),
('viking', '0001103804', 'Viking Global Investors LP', 'Viking Global', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1103804', 8),
('altimeter', '0001541617', 'Altimeter Capital Management, LP', 'Altimeter Capital', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1541617', 8),
('himalaya', '0001709323', 'Himalaya Capital Management LLC', '李录 / Himalaya', '知名投资人', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1709323', 12),
('elliott', '0001791786', 'Elliott Investment Management L.P.', 'Elliott Management', '主动基金', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1791786', 8),
('vanguard', '0000102909', 'Vanguard Group Inc', 'Vanguard', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=102909', 2),
('state-street', '0000093751', 'State Street Corp', 'State Street', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=93751', 2),
('fidelity', '0000315066', 'FMR LLC', 'Fidelity / FMR', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=315066', 2),
('t-rowe-price', '0000080255', 'T. Rowe Price Associates Inc', 'T. Rowe Price', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=80255', 2),
('jpmorgan', '0000019617', 'JPMorgan Chase & Co', 'JPMorgan', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=19617', 2),
('blackrock', '0001364742', 'BlackRock Finance, Inc.', 'BlackRock', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1364742', 2),
('goldman-sachs', '0000886982', 'Goldman Sachs Group Inc', 'Goldman Sachs', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=886982', 2),
('morgan-stanley', '0000895421', 'Morgan Stanley', 'Morgan Stanley', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=895421', 2),
('bank-of-america', '0000070858', 'Bank of America Corp', 'Bank of America', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=70858', 2),
('ubs', '0001610520', 'UBS Group AG', 'UBS', '大型机构', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1610520', 2),
('citadel', '0001423053', 'Citadel Advisors LLC', 'Citadel Advisors', '量化与多策略', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1423053', 4),
('millennium', '0001273087', 'Millennium Management LLC', 'Millennium', '量化与多策略', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1273087', 4),
('point72', '0001603466', 'Point72 Asset Management, L.P.', 'Point72', '量化与多策略', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1603466', 4),
('renaissance', '0001037389', 'Renaissance Technologies LLC', 'Renaissance Technologies', '量化与多策略', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1037389', 4),
('de-shaw', '0001009207', 'D. E. Shaw & Co., Inc.', 'D. E. Shaw', '量化与多策略', 'SEC', 'https://www.sec.gov/edgar/browse/?CIK=1009207', 4),
('arkk', NULL, 'ARK Innovation ETF', '木头姐 / ARKK', 'ARK 日频', 'ARK', 'https://www.ark-funds.com/funds/arkk', 2),
('arkg', NULL, 'ARK Genomic Revolution ETF', 'ARKG', 'ARK 日频', 'ARK', 'https://www.ark-funds.com/funds/arkg', 2),
('arkq', NULL, 'ARK Autonomous Technology & Robotics ETF', 'ARKQ', 'ARK 日频', 'ARK', 'https://www.ark-funds.com/funds/arkq', 2),
('arkw', NULL, 'ARK Next Generation Internet ETF', 'ARKW', 'ARK 日频', 'ARK', 'https://www.ark-funds.com/funds/arkw', 2),
('arkf', NULL, 'ARK Fintech Innovation ETF', 'ARKF', 'ARK 日频', 'ARK', 'https://www.ark-funds.com/funds/arkf', 2),
('arkx', NULL, 'ARK Space Exploration & Innovation ETF', 'ARKX', 'ARK 日频', 'ARK', 'https://www.ark-funds.com/funds/arkx', 2);
