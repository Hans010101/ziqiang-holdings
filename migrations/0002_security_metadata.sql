CREATE TABLE securities (
  cusip TEXT PRIMARY KEY,
  ticker TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_securities_sector ON securities(sector, industry);
