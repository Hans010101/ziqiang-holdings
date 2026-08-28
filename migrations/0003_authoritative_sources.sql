UPDATE managers SET cik='0002012383',name='BlackRock, Inc.',source_url='https://www.sec.gov/edgar/browse/?CIK=2012383' WHERE id='blackrock';
UPDATE managers SET name='ARK Blockchain & Fintech Innovation ETF' WHERE id='arkf';
UPDATE managers SET name='ARK Space & Defense Innovation ETF' WHERE id='arkx';

DELETE FROM positions WHERE filing_id IN (SELECT id FROM filings WHERE manager_id IN ('blackrock','t-rowe-price','baupost'));
DELETE FROM filings WHERE manager_id IN ('blackrock','t-rowe-price','baupost');
DELETE FROM securities;
