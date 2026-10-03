import { describe, expect, it } from "vitest";
import { containsSensitiveKey, duplicateKey } from "@job-hunt-os/contracts";
describe("agent security", () => { it("rejects hidden secret fields", () => expect(containsSensitiveKey({ nested: { apiToken: "x" } })).toBe(true)); it("uses stable duplicate keys", () => expect(duplicateKey({ company:{name:"Acme"}, job:{title:"Intern",employmentType:"internship",location:{}}, source:"x",externalId:"id1",jobUrl:"https://a.com",match:{score:1,summary:"x"},eligibility:{},discoveredAt:"2026-10-02T00:00:00.000Z" } as any)).toContain("acme")); });
