import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";
import * as jose from "jose";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const WRITE_TOKEN = process.env.COMPANY_INTELLIGENCE_WRITE_TOKEN;
const VERCEL_TEAM_SLUG = process.env.VERCEL_TEAM_SLUG || "cyberlords-projects-c47490f9";
const VERCEL_PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || "job-hunt-os-api";
const VERCEL_ISSUER = `https://oidc.vercel.com/${VERCEL_TEAM_SLUG}`;
const VERCEL_AUDIENCE = `https://vercel.com/${VERCEL_TEAM_SLUG}`;
const VERCEL_SUBJECT = `owner:${VERCEL_TEAM_SLUG}:project:${VERCEL_PROJECT_NAME}:environment:production`;
const VERCEL_JWKS = jose.createRemoteJWKSet(new URL("/.well-known/jwks", VERCEL_ISSUER));
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;

const schema = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  legal_name TEXT,
  parent_company TEXT,
  state TEXT,
  country TEXT DEFAULT 'US',
  website TEXT,
  industry TEXT,
  technical_employer BOOLEAN NOT NULL DEFAULT TRUE,
  priority SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  fortune_500 BOOLEAN,
  sp_500 BOOLEAN,
  tech_departments TEXT[] NOT NULL DEFAULT '{}',
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS career_sources (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'careers',
  provider TEXT NOT NULL DEFAULT 'custom',
  verification_status TEXT NOT NULL DEFAULT 'discovered',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_http_status INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, url)
);

CREATE TABLE IF NOT EXISTS company_aliases (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'name',
  PRIMARY KEY(company_id, alias)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  career_source_id TEXT REFERENCES career_sources(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  candidates_found INTEGER NOT NULL DEFAULT 0,
  new_candidates INTEGER NOT NULL DEFAULT 0,
  known_candidates INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS internship_discoveries (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  career_source_id TEXT REFERENCES career_sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  apply_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  season TEXT,
  location TEXT,
  work_arrangement TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posting_status TEXT NOT NULL DEFAULT 'open',
  match_score INTEGER,
  eligibility_risk TEXT,
  gate_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE(canonical_url)
);

CREATE INDEX IF NOT EXISTS companies_due_idx ON companies(active, next_check_at, priority);
CREATE INDEX IF NOT EXISTS companies_name_idx ON companies(canonical_name);
CREATE INDEX IF NOT EXISTS career_sources_company_idx ON career_sources(company_id, active);
CREATE INDEX IF NOT EXISTS career_sources_host_idx ON career_sources(host, active);
CREATE INDEX IF NOT EXISTS discoveries_company_idx ON internship_discoveries(company_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS scan_runs_company_idx ON scan_runs(company_id, started_at DESC);
`;

if (pool) await pool.query(schema);

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};
const readBody = async req => {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 1_000_000) throw new Error("payload too large");
  }
  return s ? JSON.parse(s) : {};
};
const hostOf = value => {
  try { return new URL(/^https?:\/\//i.test(String(value || "")) ? String(value) : `https://${value}`).hostname.toLowerCase().replace(/^www\./,""); }
  catch { return ""; }
};
const norm = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const stableCompanyId = (name, website) => {
  const base = hostOf(website) || norm(name);
  return "cmp_" + crypto.createHash("sha256").update(base).digest("hex").slice(0,16);
};

async function resolveCompany({ name, website, careers_url }) {
  const domains = [...new Set([hostOf(website), hostOf(careers_url)].filter(Boolean))];
  if (domains.length) {
    const q = await pool.query(`
      SELECT DISTINCT c.* FROM companies c
      LEFT JOIN career_sources s ON s.company_id=c.id
      WHERE regexp_replace(lower(coalesce(c.website,'')), '^https?://(www\\.)?', '') LIKE ANY($1)
         OR lower(s.host)=ANY($2)
      LIMIT 2
    `, [domains.map(d=>d+"%"), domains]);
    if (q.rows.length === 1) return { company:q.rows[0], matched_by:"domain", confidence:1 };
  }
  const n=norm(name);
  if (!n) return null;
  const q=await pool.query(`
    SELECT DISTINCT c.* FROM companies c
    LEFT JOIN company_aliases a ON a.company_id=c.id
    WHERE lower(regexp_replace(c.canonical_name,'[^a-zA-Z0-9]+',' ','g'))=$1
       OR lower(regexp_replace(coalesce(c.legal_name,''),'[^a-zA-Z0-9]+',' ','g'))=$1
       OR lower(regexp_replace(coalesce(a.alias,''),'[^a-zA-Z0-9]+',' ','g'))=$1
    LIMIT 2
  `,[n]);
  return q.rows.length===1 ? { company:q.rows[0], matched_by:"name_or_alias", confidence:.92 } : null;
}

const authorized = async req => {
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  if (WRITE_TOKEN) {
    const a = Buffer.from(got), b = Buffer.from(WRITE_TOKEN);
    if (a.length === b.length && crypto.timingSafeEqual(a,b)) return true;
  }
  try {
    await jose.jwtVerify(got, VERCEL_JWKS, {
      issuer: VERCEL_ISSUER,
      audience: VERCEL_AUDIENCE,
      subject: VERCEL_SUBJECT,
    });
    return true;
  } catch {
    return false;
  }
};

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin":"*", "access-control-allow-headers":"authorization,content-type", "access-control-allow-methods":"GET,POST,PUT,OPTIONS" }); return res.end();
    }
    if (req.method === "GET" && url.pathname === "/health") return json(res,200,{ok:true,service:"jobhunt-company-intelligence",database_configured:!!pool});
    if (!pool) return json(res,503,{error:"database_not_configured"});
    if (req.method === "GET" && url.pathname === "/v1/companies/resolve") {
      const found=await resolveCompany({name:url.searchParams.get("name"),website:url.searchParams.get("website"),careers_url:url.searchParams.get("careers_url")});
      return found ? json(res,200,{ok:true,...found}) : json(res,404,{ok:false,error:"company_not_found"});
    }
    if (req.method === "GET" && /^\/v1\/companies\/[^/]+$/.test(url.pathname)) {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const [company,sources,discoveries]=await Promise.all([
        pool.query("SELECT * FROM companies WHERE id=$1",[id]),
        pool.query("SELECT * FROM career_sources WHERE company_id=$1 ORDER BY active DESC, verification_status DESC, url",[id]),
        pool.query("SELECT * FROM internship_discoveries WHERE company_id=$1 ORDER BY discovered_at DESC LIMIT 100",[id])
      ]);
      if (!company.rows[0]) return json(res,404,{error:"not found"});
      return json(res,200,{ok:true,company:company.rows[0],career_sources:sources.rows,discoveries:discoveries.rows});
    }
    if (req.method === "GET" && url.pathname === "/v1/company-intelligence") {
      const [s,c] = await Promise.all([
        pool.query(`SELECT
          (SELECT count(*)::int FROM companies) companies,
          (SELECT count(*)::int FROM companies WHERE active) active_companies,
          (SELECT count(*)::int FROM companies WHERE technical_employer) technical_employers,
          (SELECT count(*)::int FROM career_sources) career_sources,
          (SELECT count(*)::int FROM career_sources WHERE verification_status='verified' AND active) verified_sources,
          (SELECT count(*)::int FROM career_sources WHERE consecutive_failures > 0 AND active) failing_sources`),
        pool.query(`SELECT c.*,
          count(s.id)::int source_count,
          count(s.id) FILTER (WHERE s.verification_status='verified' AND s.active)::int verified_source_count,
          count(s.id) FILTER (WHERE s.consecutive_failures>0 AND s.active)::int failing_source_count
          FROM companies c LEFT JOIN career_sources s ON s.company_id=c.id
          GROUP BY c.id ORDER BY c.priority, c.canonical_name LIMIT 5000`)
      ]);
      return json(res,200,{ok:true,generated_at:new Date().toISOString(),summary:s.rows[0],companies:c.rows});
    }
    if (!(await authorized(req))) return json(res,401,{error:"unauthorized"});
    if (req.method === "POST" && url.pathname === "/v1/companies/upsert") {
      const b=await readBody(req);
      const existing=await resolveCompany(b);
      const id=b.id || existing?.company?.id || stableCompanyId(b.canonical_name || b.name,b.website);
      const canonical=b.canonical_name || b.name;
      if (!canonical) return json(res,422,{error:"canonical_name required"});
      const q=await pool.query(`INSERT INTO companies
        (id,canonical_name,legal_name,parent_company,state,country,website,industry,technical_employer,priority,active,fortune_500,sp_500,tech_departments,updated_at)
        VALUES ($1,$2,$3,$4,$5,COALESCE($6,'US'),$7,$8,COALESCE($9,true),COALESCE($10,3),COALESCE($11,true),$12,$13,COALESCE($14::text[],'{}'::text[]),now())
        ON CONFLICT(id) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,legal_name=EXCLUDED.legal_name,parent_company=EXCLUDED.parent_company,
        state=EXCLUDED.state,country=EXCLUDED.country,website=EXCLUDED.website,industry=EXCLUDED.industry,
        technical_employer=EXCLUDED.technical_employer,priority=EXCLUDED.priority,active=EXCLUDED.active,
        fortune_500=EXCLUDED.fortune_500,sp_500=EXCLUDED.sp_500,tech_departments=EXCLUDED.tech_departments,updated_at=now()
        RETURNING *`,
        [id,canonical,b.legal_name??null,b.parent_company??null,b.state??null,b.country??"US",b.website??null,b.industry??null,
         b.technical_employer!==false,b.priority??3,b.active!==false,b.fortune_500??null,b.sp_500??null,b.tech_departments??[]]);
      const aliases=[b.name,b.canonical_name,b.legal_name,...(Array.isArray(b.aliases)?b.aliases:[])].filter(Boolean);
      for(const alias of [...new Set(aliases)]) await pool.query("INSERT INTO company_aliases(company_id,alias,alias_type) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[id,String(alias),"name"]);
      return json(res,200,{ok:true,company:q.rows[0],matched_existing:!!existing,created:!existing});
    }
    if (req.method === "POST" && url.pathname === "/v1/companies/scan-status") {
      const b=await readBody(req);
      const ok=b.ok!==false;
      const row=await pool.query("SELECT priority FROM companies WHERE id=$1",[b.company_id]);
      if(!row.rows[0]) return json(res,404,{error:"company_not_found"});
      const p=Number(row.rows[0].priority??3);
      const hours=p<=1?2:p===2?6:p===3?12:24;
      const q=await pool.query(`UPDATE companies
        SET last_checked_at=now(),
            last_success_at=CASE WHEN $2 THEN now() ELSE last_success_at END,
            next_check_at=now()+($3 || ' hours')::interval,
            consecutive_failures=CASE WHEN $2 THEN 0 ELSE consecutive_failures+1 END,
            updated_at=now()
        WHERE id=$1 RETURNING *`,[b.company_id,ok,String(ok?hours:1)]);
      return json(res,200,{ok:true,company:q.rows[0]});
    }
    if (req.method === "POST" && url.pathname === "/v1/career-sources/upsert") {
      const b=await readBody(req);
      const before=await pool.query("SELECT id, verification_status FROM career_sources WHERE company_id=$1 AND url=$2 LIMIT 1",[b.company_id,b.url]);
      const fallbackId="src_"+crypto.createHash("sha256").update(String(b.company_id)+"|"+String(b.url)).digest("hex").slice(0,20);
      let sourceId=before.rows[0]?.id || b.id || fallbackId;
      if (!before.rows[0] && b.id) {
        const collision=await pool.query("SELECT 1 FROM career_sources WHERE id=$1 LIMIT 1",[b.id]);
        if (collision.rows.length) sourceId=fallbackId;
      }
      const q=await pool.query(`INSERT INTO career_sources
        (id,company_id,url,host,source_type,provider,verification_status,active,metadata,updated_at)
        VALUES ($1,$2,$3,$4,COALESCE($5,'careers'),COALESCE($6,'custom'),COALESCE($7,'discovered'),COALESCE($8,true),COALESCE($9,'{}'::jsonb),now())
        ON CONFLICT(company_id,url) DO UPDATE SET host=EXCLUDED.host,source_type=EXCLUDED.source_type,provider=EXCLUDED.provider,
        verification_status=EXCLUDED.verification_status,active=EXCLUDED.active,metadata=EXCLUDED.metadata,updated_at=now()
        RETURNING *`,
        [sourceId,b.company_id,b.url,b.host,b.source_type??"careers",b.provider??"custom",b.verification_status??"discovered",b.active!==false,b.metadata??{}]);
      return json(res,200,{ok:true,source:q.rows[0],created:before.rows.length===0,previous_verification_status:before.rows[0]?.verification_status??null});
    }
    if (req.method === "POST" && url.pathname === "/v1/discoveries/upsert") {
      const b=await readBody(req);
      const id=b.id || "disc_"+crypto.createHash("sha256").update(String(b.canonical_url||b.apply_url||"")).digest("hex").slice(0,20);
      const q=await pool.query(`INSERT INTO internship_discoveries
        (id,company_id,career_source_id,title,apply_url,canonical_url,season,location,work_arrangement,posting_status,match_score,eligibility_risk,gate_id,metadata,last_seen_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'open'),$11,$12,$13,COALESCE($14,'{}'::jsonb),now())
        ON CONFLICT(canonical_url) DO UPDATE SET company_id=EXCLUDED.company_id,career_source_id=EXCLUDED.career_source_id,title=EXCLUDED.title,
        last_seen_at=now(),posting_status=EXCLUDED.posting_status,match_score=EXCLUDED.match_score,eligibility_risk=EXCLUDED.eligibility_risk,
        gate_id=COALESCE(EXCLUDED.gate_id,internship_discoveries.gate_id),metadata=EXCLUDED.metadata RETURNING *`,
        [id,b.company_id,b.career_source_id??null,b.title,b.apply_url,b.canonical_url||b.apply_url,b.season??null,b.location??null,b.work_arrangement??null,b.posting_status??"open",b.match_score??null,b.eligibility_risk??null,b.gate_id??null,b.metadata??{}]);
      return json(res,200,{ok:true,discovery:q.rows[0]});
    }
    return json(res,404,{error:"not found"});
  } catch (e) {
    console.error(e);
    return json(res,500,{error:e instanceof Error ? e.message : "internal error"});
  }
});

async function normalizeLegacyMisclassifiedCompany() {
  const bogusId = "cmp_74234e98afe7498f";
  const rows = await pool.query(
    \`SELECT d.*, s.provider AS old_provider, s.verification_status AS old_verification
     FROM internship_discoveries d
     LEFT JOIN career_sources s ON s.id=d.career_source_id
     WHERE d.company_id=$1 ORDER BY d.id\`, [bogusId]
  );
  if (!rows.rows.length) return;

  const greenhouse = {
    andurilindustries:["Anduril Industries","https://www.anduril.com/"],
    datacor:["Datacor","https://www.datacor.com/"],
    freeformfuturecorp:["Freeform","https://freeform.co/"],
    langanengineeringandenvironmentalservicesllc:["Langan Engineering & Environmental Services","https://www.langan.com/"],
    muonspace:["Muon Space","https://www.muonspace.com/"],
    ncinoearlytalent:["nCino","https://www.ncino.com/"],
    robinhood:["Robinhood","https://robinhood.com/"],
    spacex:["SpaceX","https://www.spacex.com/"],
    thenuclearcompany:["The Nuclear Company","https://www.thenuclearcompany.com/"],
    veeamsoftware:["Veeam Software","https://www.veeam.com/"]
  };
  const lever = {
    anavationllc:["AnaVation","https://anavationllc.com/"],
    belvederetrading:["Belvedere Trading","https://www.belvederetrading.com/"],
    cesiumastro:["CesiumAstro","https://www.cesiumastro.com/"],
    "futo-org":["FUTO","https://futo.org/"],
    hermeus:["Hermeus","https://www.hermeus.com/"],
    immuta:["Immuta","https://www.immuta.com/"],
    sep:["SEP","https://sep.com/"],
    shieldai:["Shield AI","https://shield.ai/"]
  };
  const direct = {
    "careers.gevernova.com":["GE Vernova","https://www.gevernova.com/"],
    "careers.cargill.com":["Cargill","https://www.cargill.com/"],
    "careers.amd.com":["AMD","https://www.amd.com/"],
    "jobs.baesystems.com":["BAE Systems","https://www.baesystems.com/"],
    "careers.twosigma.com":["Two Sigma","https://www.twosigma.com/"],
    "careers.roblox.com":["Roblox","https://www.roblox.com/"],
    "careers.robinhood.com":["Robinhood","https://robinhood.com/"],
    "careers.bu.edu":["Robinhood","https://robinhood.com/"]
  };
  const identify = value => {
    try {
      const u = new URL(value), h=u.hostname.toLowerCase(), seg=u.pathname.split("/").filter(Boolean);
      if (h === "example.com") return { drop:true };
      if (h === "job-boards.greenhouse.io" && seg[0]) {
        const v=greenhouse[seg[0].toLowerCase()]; if(v) return {name:v[0],website:v[1],verified:true};
      }
      if (h === "jobs.lever.co" && seg[0]) {
        const v=lever[seg[0].toLowerCase()]; if(v) return {name:v[0],website:v[1],verified:true};
      }
      const v=direct[h];
      if(v) return {name:v[0],website:v[1],verified:h!=="careers.bu.edu"};
    } catch {}
    return null;
  };

  const db = await pool.connect();
  let moved=0, dropped=0, unresolved=0;
  try {
    await db.query("BEGIN");
    for (const d of rows.rows) {
      const target=identify(d.canonical_url || d.apply_url);
      if (!target) { unresolved++; continue; }
      if (target.drop) {
        await db.query("DELETE FROM internship_discoveries WHERE id=$1",[d.id]);
        dropped++; continue;
      }
      const companyId=stableCompanyId(target.name,target.website);
      await db.query(\`INSERT INTO companies
        (id,canonical_name,website,technical_employer,priority,active,tech_departments,updated_at)
        VALUES($1,$2,$3,true,3,true,'{}'::text[],now())
        ON CONFLICT(id) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,
          website=COALESCE(companies.website,EXCLUDED.website),active=true,updated_at=now()\`,
        [companyId,target.name,target.website]);
      const sourceUrl=d.canonical_url || d.apply_url;
      const host=hostOf(sourceUrl);
      const sourceId="src_"+crypto.createHash("sha256").update(companyId+"|"+sourceUrl).digest("hex").slice(0,20);
      const sq=await db.query(\`INSERT INTO career_sources
        (id,company_id,url,host,source_type,provider,verification_status,active,metadata,updated_at)
        VALUES($1,$2,$3,$4,'posting_source',$5,$6,true,$7::jsonb,now())
        ON CONFLICT(company_id,url) DO UPDATE SET host=EXCLUDED.host,provider=EXCLUDED.provider,
          verification_status=EXCLUDED.verification_status,active=true,updated_at=now()
        RETURNING id\`,
        [sourceId,companyId,sourceUrl,host,d.old_provider||"custom",target.verified?"verified":"discovered",JSON.stringify({normalized_from_legacy_company:bogusId})]);
      await db.query("UPDATE internship_discoveries SET company_id=$1,career_source_id=$2,last_seen_at=now() WHERE id=$3",
        [companyId,sq.rows[0].id,d.id]);
      moved++;
    }
    if (unresolved===0) {
      await db.query("DELETE FROM career_sources WHERE company_id=$1",[bogusId]);
      await db.query("DELETE FROM companies WHERE id=$1",[bogusId]);
    }
    await db.query("COMMIT");
    console.log("legacy_company_normalization_complete",JSON.stringify({moved,dropped,unresolved}));
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally { db.release(); }
}

if (pool) await normalizeLegacyMisclassifiedCompany();

server.listen(Number(process.env.PORT||10000),"0.0.0.0");
