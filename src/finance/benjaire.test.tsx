import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ManifestIssue } from "../catalog/types";
import { FINANCIAL_BUILDINGS, financialKey } from "../views/map3d/financialPlan";
import { buildingOrganization } from "../modules/names";
import { FinanceList } from "../components/BenjaireFinance";
import { buildingFinance, datasetState, FINANCE_BUSINESS, FINANCE_PLAN, financePlanIssues, financeSignLines, parseFinancePlan } from "./benjaire";

describe("Benjaire finance plan", () => {
  it("loads cleanly and gives every Financial District building, all owned by Benjaire, a place for its data", () => {
    expect(financePlanIssues).toEqual([]);
    expect(FINANCE_BUSINESS).toBe("Benjaire");
    for (const b of FINANCIAL_BUILDINGS) {
      const key = financialKey(b.id);
      expect(buildingOrganization(key), key).toBe("Benjaire");
      expect(buildingFinance(key)?.datasets.length, key).toBeGreaterThan(0);
    }
    const mapKeys = new Set(FINANCIAL_BUILDINGS.map((b) => financialKey(b.id)));
    for (const key of Object.keys(FINANCE_PLAN.buildings)) expect(mapKeys.has(key), key).toBe(true);
  });

  it("only uses feeds Atlas already has, on the Financial Operations Tower", () => {
    const fed = Object.values(FINANCE_PLAN.buildings).flatMap((b) => b.datasets.filter((d) => d.feed).map((d) => `${b.key} ${d.feed}`));
    expect(fed).toEqual(["service:financial:banks ai-spend", "service:financial:banks spend-caps"]);
  });

  it("refuses statuses, dates or figures in the file, unknown feeds and duplicate ids", () => {
    const issues: ManifestIssue[] = [];
    parseFinancePlan("f", `schema: atlas/finance-v1
buildings:
  "service:financial:banks":
    focus: Cash
    datasets:
      - {id: a, label: A, holds: x, fields: [f], sources: [s], status: live}
      - {id: b, label: B, holds: x, fields: [f], sources: [s], feed: bank-login}
      - {id: c, label: C, holds: x, fields: [f], sources: [s]}
      - {id: c, label: C, holds: x, fields: [f], sources: [s]}
  "service:atlas-station":
    focus: Nope
`, issues);
    const text = issues.map((i) => i.message).join("\n");
    expect(text).toMatch(/datasets\[0\]: status, dates and figures/);
    expect(text).toMatch(/datasets\[1\]\.feed/);
    expect(text).toMatch(/datasets\[3\]\.id: "c" is used/);
    expect(text).toMatch(/service:atlas-station: use a Financial District building id/);
  });

  it("signs each tower with the workspace name over its role, and leaves Team Residence Towers unsigned", () => {
    expect(financeSignLines(financialKey("banks"))).toEqual(["Benjaire", "Financial Operations"]);
    expect(financeSignLines(financialKey("business-finance"), FINANCE_PLAN, "Another Co")).toEqual(["Another Co", "Business Finance"]);
    expect(financeSignLines(financialKey("circa"))).toBeUndefined();
    for (const b of Object.values(FINANCE_PLAN.buildings)) expect((b.sign ?? "").length, b.key).toBeLessThanOrEqual(22);
  });

  it("is Live only when a feed has data, Imported only with records, otherwise Not connected", () => {
    const fed = buildingFinance(financialKey("banks"))!.datasets.find((d) => d.feed === "ai-spend")!;
    const plain = buildingFinance(financialKey("banks"))!.datasets.find((d) => d.id === "bank-accounts")!;
    expect(datasetState(fed, {}).status).toBe("not-connected");
    expect(datasetState(fed, { "ai-spend": null }).status).toBe("not-connected");
    expect(datasetState(fed, { "ai-spend": { asOf: "2026-11-10T00:00:00Z" } })).toMatchObject({ status: "live", source: "Atlas API Usage" });
    expect(datasetState(plain, { "ai-spend": { asOf: null } }).status).toBe("not-connected");
    expect(datasetState(plain, {}, { "bank-accounts": { asOf: "2026-11-01", source: "Bank statement CSV" } })).toMatchObject({ status: "imported", source: "Bank statement CSV" });
  });

  it("shows a clear empty state and no figures when nothing is connected", () => {
    const html = renderToStaticMarkup(<FinanceList plan={buildingFinance(financialKey("business-finance"))!} feeds={{}} />);
    expect(html).toContain("Benjaire finance");
    expect(html).toContain("none connected yet");
    expect(html).toContain("Invoices and receivables");
    expect(html).toContain("No data yet · Can come from");
    expect(html).not.toMatch(/\$\d|Live</);
  });
});
