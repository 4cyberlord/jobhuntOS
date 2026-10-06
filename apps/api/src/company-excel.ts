import { graphAccess } from "./outlook.js";

type Intelligence = {
  generated_at?: string;
  summary?: Record<string, number>;
  companies?: Array<Record<string, unknown>>;
  career_sources?: Array<Record<string, unknown>>;
};

const headers = {
  companies: [
    "Company ID","Canonical Company Name","Legal Name","State","Industry","Corporate Website",
    "Technical Employer","Priority Tier","Active","Career Sources","Verified Sources","Failing Sources",
    "Last Checked","Last Success","Next Check","Consecutive Failures"
  ],
  sources: [
    "Source ID","Company ID","Company Name","Source Type","Provider","URL","Host",
    "Verification Status","Active","Last Checked","Last Success","HTTP Status","Consecutive Failures"
  ],
};

function cfg() {
  const driveId = process.env.COMPANY_INTELLIGENCE_DRIVE_ID;
  const itemId = process.env.COMPANY_INTELLIGENCE_WORKBOOK_ITEM_ID;
  if (!driveId || !itemId) throw new Error("Company Intelligence workbook is not configured.");
  return { driveId, itemId };
}
const col = (n: number) => {
  let out = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
const iso = (v: unknown) => typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : "";
const bool = (v: unknown) => Number(v) ? "Yes" : "No";

async function graph(path: string, init: RequestInit = {}) {
  const { token } = await graphAccess();
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Microsoft Graph ${r.status}: ${body.slice(0, 500)}`);
  }
  if (r.status === 204) return null;
  return r.json().catch(() => null);
}

const workbookBase = () => {
  const { driveId, itemId } = cfg();
  return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook`;
};

async function ensureSheet(name: string) {
  const base = workbookBase();
  const get = await graph(`${base}/worksheets`) as { value?: Array<{ name?: string }> };
  if ((get?.value ?? []).some((x) => x.name === name)) return;
  await graph(`${base}/worksheets/add`, { method: "POST", body: JSON.stringify({ name }) });
}

async function clearRange(sheet: string, address: string) {
  const base = workbookBase();
  const escaped = address.replace(/'/g, "''");
  await graph(`${base}/worksheets/${encodeURIComponent(sheet)}/range(address='${escaped}')/clear`, {
    method: "POST",
    body: JSON.stringify({ applyTo: "All" }),
  });
}

async function writeRange(sheet: string, startRow: number, rows: unknown[][]) {
  if (!rows.length) return;
  const width = rows[0]!.length;
  const endRow = startRow + rows.length - 1;
  const address = `A${startRow}:${col(width)}${endRow}`;
  const base = workbookBase();
  await graph(`${base}/worksheets/${encodeURIComponent(sheet)}/range(address='${address}')`, {
    method: "PATCH",
    body: JSON.stringify({ values: rows }),
  });
}

async function rewriteSheet(sheet: string, head: string[], rows: unknown[][], maxRows: number) {
  await ensureSheet(sheet);
  await clearRange(sheet, `A1:${col(head.length)}${maxRows}`);
  await writeRange(sheet, 1, [head]);
  for (let i = 0; i < rows.length; i += 250) {
    await writeRange(sheet, i + 2, rows.slice(i, i + 250));
  }
}

async function fetchIntelligence(): Promise<Intelligence> {
  const base = (process.env.GATE_DISCOVERY_URL || "https://gate-discovery.4cyberlord.workers.dev").replace(/\/+$/, "");
  const r = await fetch(`${base}/company-intelligence`, { headers: { "user-agent": "job-hunt-os-api/1.0" } });
  if (!r.ok) throw new Error(`Company Intelligence upstream returned ${r.status}.`);
  return r.json() as Promise<Intelligence>;
}

export function companyWorkbookConfigured() {
  return !!(process.env.COMPANY_INTELLIGENCE_DRIVE_ID && process.env.COMPANY_INTELLIGENCE_WORKBOOK_ITEM_ID);
}

export async function syncCompanyIntelligenceWorkbook() {
  const intel = await fetchIntelligence();
  const companies = (intel.companies ?? []).map((c) => [
    c.id ?? "", c.canonical_name ?? "", c.legal_name ?? "", c.state ?? "", c.industry ?? "", c.website ?? "",
    bool(c.technical_employer), `Tier ${Number(c.priority ?? 3)}`, bool(c.active),
    Number(c.source_count ?? 0), Number(c.verified_source_count ?? 0), Number(c.failing_source_count ?? 0),
    iso(c.last_checked_at), iso(c.last_success_at), iso(c.next_check_at), Number(c.consecutive_failures ?? 0),
  ]);
  const sources = (intel.career_sources ?? []).map((s) => [
    s.id ?? "", s.company_id ?? "", s.company_name ?? "", s.source_type ?? "", s.provider ?? "", s.url ?? "", s.host ?? "",
    s.verification_status ?? "", bool(s.active), iso(s.last_checked_at), iso(s.last_success_at),
    s.last_http_status ?? "", Number(s.consecutive_failures ?? 0),
  ]);
  const summary = intel.summary ?? {};
  const coverageRows = [
    ["GATE Company Intelligence — Coverage Summary", ""],
    ["Generated At", intel.generated_at ?? new Date().toISOString()],
    ["Companies", Number(summary.companies ?? 0)],
    ["Active Companies", Number(summary.active_companies ?? 0)],
    ["Technical Employers", Number(summary.technical_employers ?? 0)],
    ["Career Sources", Number(summary.career_sources ?? 0)],
    ["Verified Sources", Number(summary.verified_sources ?? 0)],
    ["Failing Sources", Number(summary.failing_sources ?? 0)],
    ["Companies With Failures", Number(summary.companies_with_failures ?? 0)],
  ];

  await rewriteSheet("Companies", headers.companies, companies, 5002);
  await rewriteSheet("Career Sources", headers.sources, sources, 10002);
  await ensureSheet("Coverage Summary");
  await clearRange("Coverage Summary", "A1:H100");
  await writeRange("Coverage Summary", 1, coverageRows);

  return {
    ok: true,
    generated_at: intel.generated_at ?? null,
    companies_written: companies.length,
    career_sources_written: sources.length,
  };
}
