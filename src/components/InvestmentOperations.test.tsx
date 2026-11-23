import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InvestmentOperations } from "./InvestmentOperations";

// Synthetic accounts only.
const snapshot = { source: "robinhood" as const, as_of: new Date().toISOString(), portfolios: [
  { label: "Demo", kind: "individual" as const, last4: "0000", agent_tradable: false, cash: 10, positions: [{ symbol: "DEMOA", asset_class: "equity" as const, market_value: 90 }] },
  { label: "Agentic", kind: "individual" as const, last4: "1111", agent_tradable: true, cash: 0, positions: [] },
] };

it("shows each account by label and last four, marks the agent trading account, and offers Disconnect", () => {
  const html = renderToStaticMarkup(<InvestmentOperations initial={{ kind: "ok", path: "/demo/snapshot.json", snapshot }} />);
  expect(html).toContain("Demo ••0000");
  expect(html).toContain("Agentic ••1111");
  expect(html).toContain("Agent trading account");
  expect(html).toContain("Synced");
  expect(html).toContain("Disconnect");
  expect(html).not.toContain("Synthetic preview");
  expect(html).toContain("not investment advice");
});

it("keeps the website on the labelled synthetic preview", () => {
  const html = renderToStaticMarkup(<InvestmentOperations initial={{ kind: "web" }} />);
  expect(html).toContain("Not connected");
  expect(html).toContain("Invented data · not your account");
  expect(html).toContain("only in the Atlas Mac app");
  expect(html).not.toContain("Disconnect");
});

it("tells the Mac how to sync before the first snapshot", () => {
  const html = renderToStaticMarkup(<InvestmentOperations initial={{ kind: "none", path: "/demo/snapshot.json" }} />);
  expect(html).toContain("sync my investments");
  expect(html).toContain("/demo/snapshot.json");
  expect(html).toContain("Refresh");
});
