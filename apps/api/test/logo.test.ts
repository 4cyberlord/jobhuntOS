import { describe, expect, it } from "vitest";
import { companyDomains, logoSources, rootDomain } from "@job-hunt-os/contracts";

const first = (name: string, applyUrl?: string, website?: string) => companyDomains(name, { applyUrl, website })[0];

describe("rootDomain", () => {
  it("strips subdomains and handles two-part TLDs", () => {
    expect(rootDomain("careers.veeam.com")).toBe("veeam.com");
    expect(rootDomain("www.notion.com")).toBe("notion.com");
    expect(rootDomain("jobs.acme.co.uk")).toBe("acme.co.uk");
  });
});

describe("companyDomains: real records from the inbox", () => {
  it("uses the company's own apply domain when it matches the name", () => {
    expect(first("Coinbase", "https://www.coinbase.com/careers/positions/1")).toBe("coinbase.com");
    expect(first("Veeam", "https://careers.veeam.com/job/1")).toBe("veeam.com");
    expect(first("Gecko Robotics", "https://www.geckorobotics.com/careers/1")).toBe("geckorobotics.com");
    expect(first("Citizens", "https://jobs.citizensbank.com/job/1")).toBe("citizensbank.com");
  });
  it("never takes the logo of a job board", () => {
    const d = companyDomains("Commure", { applyUrl: "https://jobs.ashbyhq.com/Commure/abc" });
    expect(d).not.toContain("ashbyhq.com");
    expect(d[0]).toBe("commure.com");
    expect(companyDomains("Robinhood", { applyUrl: "https://job-boards.greenhouse.io/robinhood/jobs/1" })[0]).toBe("robinhood.com");
    expect(companyDomains("Workiva", { applyUrl: "https://workiva.wd1.myworkdayjobs.com/en-US/careers/job/1" })[0]).toBe("workiva.com");
  });
  it("never takes the logo of a university career site", () => {
    const robinhood = companyDomains("Robinhood", { applyUrl: "https://careers.bu.edu/jobs/robinhood" });
    const plaid = companyDomains("Plaid", { applyUrl: "https://careerdesign.dartmouth.edu/jobs/plaid" });
    expect(robinhood).not.toContain("bu.edu");
    expect(plaid).not.toContain("dartmouth.edu");
    expect(robinhood[0]).toBe("robinhood.com");
    expect(plaid[0]).toBe("plaid.com");
  });
  it("does not trust an unrelated company-looking apply domain", () => {
    expect(companyDomains("Plaid", { applyUrl: "https://careers.somethingelse.com/1" })).not.toContain("somethingelse.com");
  });
  it("prefers an explicit website, then guesses from the name", () => {
    expect(first("Anything", undefined, "https://www.example.org/about")).toBe("example.org");
    expect(first("Scale AI")).toBe("scaleai.com");
    expect(first("PDT Partners")).toBe("pdtpartners.com");
    expect(companyDomains("IMC Trading")).toContain("imc.com");
    expect(first("Acme, Inc.")).toBe("acme.com");
  });
  it("returns clean, unique domains and nothing for unusable input", () => {
    const d = companyDomains("Notion", { applyUrl: "https://www.notion.com/careers", website: "https://notion.com" });
    expect(new Set(d).size).toBe(d.length);
    expect(d.every((x) => /^[a-z0-9.-]+$/.test(x))).toBe(true);
    expect(companyDomains("")).toEqual([]);
    expect(companyDomains("??")).toEqual([]);
  });
});

describe("logoSources", () => {
  it("only uses the two hosts the app's CSP allows", () => {
    for (const u of logoSources("notion.com")) expect(["t3.gstatic.com", "icons.duckduckgo.com"]).toContain(new URL(u).hostname);
  });
});

import { evidencedDomains, homepageMatchesCompany, pageIdentity } from "@job-hunt-os/contracts";

describe("evidencedDomains: only what the data vouches for", () => {
  it("never includes a name guess or a job board", () => {
    expect(evidencedDomains("Commure", { applyUrl: "https://jobs.ashbyhq.com/Commure/abc" })).toEqual([]);
    expect(evidencedDomains("Robinhood", { applyUrl: "https://careers.bu.edu/jobs/robinhood" })).toEqual([]);
    expect(evidencedDomains("Coinbase", { applyUrl: "https://www.coinbase.com/careers/1" })).toEqual(["coinbase.com"]);
    expect(evidencedDomains("Acme", { website: "https://www.acme.io" })).toEqual(["acme.io"]);
  });
});

describe("homepageMatchesCompany: telling the real company from a namesake", () => {
  const page = (title: string, extra = "") => `<html><head><title>${title}</title>${extra}</head><body></body></html>`;
  it("accepts a homepage that names the company", () => {
    expect(homepageMatchesCompany(page("Notion: The AI workspace"), "Notion")).toBe(true);
    expect(homepageMatchesCompany(page("Home"), "Gecko Robotics")).toBe(false);
    expect(homepageMatchesCompany(page("x", '<meta property="og:site_name" content="Gecko Robotics">'), "Gecko Robotics")).toBe(true);
    expect(homepageMatchesCompany(page("Citizens | Personal &amp; Business Banking"), "Citizens")).toBe(true);
    expect(homepageMatchesCompany(page("Citizens Bank - Personal Banking"), "Citizens")).toBe(true);
    expect(homepageMatchesCompany(page("IMC | Global trading firm"), "IMC Trading")).toBe(true);
    expect(homepageMatchesCompany(page("Scale AI: The Data Engine"), "Scale AI")).toBe(true);
  });
  it("rejects a namesake or an unrelated site", () => {
    expect(homepageMatchesCompany(page("Circle Back Cafe - Coffee &amp; Pastries"), "Circleback")).toBe(false);
    expect(homepageMatchesCompany(page("Domain for sale"), "Plaid")).toBe(false);
    expect(homepageMatchesCompany(page("Plaid Pizza | Best slices in town"), "Plaid")).toBe(false);
    expect(homepageMatchesCompany("", "Plaid")).toBe(false);
  });
  it("reads title, og:site_name and og:title in either attribute order", () => {
    expect(pageIdentity('<meta content="Zip" property="og:site_name"><title>t</title>')).toEqual(["t", "Zip"]);
  });
});

describe("known-ambiguous names", () => {
  it("map to the checked domain, never the namesake", () => {
    expect(companyDomains("Citizens", { applyUrl: "https://career.eoss.asu.edu/jobs/1" })[0]).toBe("citizensbank.com");
    expect(companyDomains("Circleback", { applyUrl: "https://jobs.ashbyhq.com/circleback/1" })[0]).toBe("circleback.ai");
    expect(companyDomains("Zip")[0]).toBe("zip.com");
    expect(evidencedDomains("DoorDash", { applyUrl: "https://careersatdoordash.com/x" })[0]).toBe("doordash.com");
  });
  it("an explicit website still beats the override", () => {
    expect(companyDomains("Citizens", { website: "https://www.example-bank.com" })[0]).toBe("example-bank.com");
  });
});
