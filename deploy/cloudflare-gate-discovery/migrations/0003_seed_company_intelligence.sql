INSERT INTO gate_companies (id, canonical_name, legal_name, state, website, industry, technical_employer, priority, active, next_check_at)
VALUES
  ('microsoft','Microsoft Corporation','Microsoft Corporation','WA','https://www.microsoft.com','Technology',1,1,1,0),
  ('amazon','Amazon','Amazon.com, Inc.','WA','https://www.amazon.com','Technology / Retail',1,1,1,0),
  ('tiktok','TikTok','TikTok Inc.','CA','https://www.tiktok.com','Technology / Media',1,1,1,0),
  ('walmart','Walmart','Walmart Inc.','AR','https://www.walmart.com','Retail / Technology',1,1,1,0)
ON CONFLICT(id) DO UPDATE SET
  canonical_name=excluded.canonical_name,
  legal_name=excluded.legal_name,
  state=excluded.state,
  website=excluded.website,
  industry=excluded.industry,
  technical_employer=1,
  priority=1,
  active=1,
  updated_at=unixepoch();

INSERT INTO gate_career_sources (id, company_id, url, host, source_type, provider, verification_status, active)
VALUES
  ('seed-microsoft-careers','microsoft','https://careers.microsoft.com/v2/global/en/home.html','careers.microsoft.com','careers','custom','verified',1),
  ('seed-amazon-careers','amazon','https://www.amazon.jobs/en/','www.amazon.jobs','careers','custom','verified',1),
  ('seed-tiktok-careers','tiktok','https://lifeattiktok.com/earlycareers','lifeattiktok.com','early_careers','custom','verified',1),
  ('seed-walmart-careers','walmart','https://careers.walmart.com/us/en/home/careers-areas/technology','careers.walmart.com','careers','custom','verified',1)
ON CONFLICT(company_id,url) DO UPDATE SET
  host=excluded.host,
  source_type=excluded.source_type,
  provider=excluded.provider,
  verification_status='verified',
  active=1,
  updated_at=unixepoch();
