import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useAtlas } from "../../state";
import { newId } from "../../tasks/lifecycle";
import type { BusinessFilter, Overview } from "../../business/dashboard";
import { inPeriod, METRIC_DEFINITIONS } from "../../business/finance";
import { draftSale, money, netCents, parseMoney } from "../../business/revenue";
import { businessStore } from "../../business/store";
import { fetchStripeSales } from "../../business/stripeClient";
import { MAX_RANGE_DAYS, planSync, syncRange, type SalesFeed, type SyncPlan } from "../../business/stripeFeed";
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, type BusinessData, type Expense, type ExpenseCategory } from "../../business/types";
import { Empty, ErrorLine, Field, ME, nowIso, Panel, pct, ProvChip, ProvenanceFields, today } from "./parts";

export function FinanceTab({ data, o, filter }: { data: BusinessData; o: Overview; filter: BusinessFilter }) {
  const { setView } = useAtlas();
  const [form, setForm] = useState<"sale" | "expense" | null>(null);
  const st = o.statement;
  const sales = data.sales.filter((s) => s.provenance === filter.provenance && inPeriod(s.date, filter.period) && (!filter.product || s.productRef === filter.product) && (filter.source === "all" || s.verification === filter.source)).sort((a, b) => b.date.localeCompare(a.date));
  const expenses = data.expenses.filter((e) => e.provenance === filter.provenance && inPeriod(e.date, filter.period) && (!filter.product || e.productRef === filter.product)).sort((a, b) => b.date.localeCompare(a.date));
  const testMode = filter.provenance === "test";
  return (
    <>
      <div className="biz-actions-row">
        <p className="muted small">Figures for {filter.period.from} to {filter.period.to}. Money is kept in whole cents per currency and never converted. Stripe sales come in with "Sync from Stripe" (read only, through n8n); anything else is entered from its own dashboard, and each sale names where it can be checked.</p>
        <div className="task-actions">
          <button className="btn primary" onClick={() => setForm("sale")}><Icon name="plus" size={14} /> Record sale</button>
          <button className="btn" onClick={() => setForm("expense")}><Icon name="plus" size={14} /> Record expense</button>
        </div>
      </div>

      {!testMode && <StripeSync data={data} />}

      {st.currencies.length ? st.currencies.map((c) => (
        <section key={c.currency} className="card card-pad">
          <div className="section-title">Statement · {c.currency}{c.estimatedExpenseCents ? " · includes estimates" : ""}</div>
          <table className="table compact biz-statement">
            <tbody>
              <Row label="Gross revenue" def={METRIC_DEFINITIONS.gross} v={money(c.grossCents, c.currency)} />
              <Row label="Refunds" def={METRIC_DEFINITIONS.refunds} v={`− ${money(c.refundCents, c.currency)}`} />
              <Row label="Transaction fees" def={METRIC_DEFINITIONS.fees} v={`− ${money(c.feeCents, c.currency)}`} />
              <Row label="Net revenue" def={METRIC_DEFINITIONS.net} v={money(c.netRevenueCents, c.currency)} strong />
              <Row label="Product-specific costs" def={METRIC_DEFINITIONS.productCost} v={`− ${money(c.productCostCents, c.currency)}`} />
              <Row label="Contribution margin" def={METRIC_DEFINITIONS.contribution} v={`${money(c.contributionCents, c.currency)}${c.contributionMargin === null ? "" : ` (${pct(c.contributionMargin)})`}`} />
              <Row label="AI API expenses" def={METRIC_DEFINITIONS.ai} v={money(c.expensesByCategory.ai ?? 0, c.currency)} />
              <Row label="Infrastructure expenses" def={METRIC_DEFINITIONS.infra} v={money(c.expensesByCategory.infrastructure ?? 0, c.currency)} />
              <Row label="All operating expenses" def={METRIC_DEFINITIONS.opex} v={`− ${money(c.operatingExpenseCents, c.currency)}`} />
              <Row label="Estimated operating profit" def={METRIC_DEFINITIONS.profit} v={`${money(c.profitCents, c.currency)}${c.margin === null ? "" : ` (${pct(c.margin)})`}`} strong />
            </tbody>
          </table>
        </section>
      )) : <Empty title="Nothing recorded for this period"><p className="muted">Record sales and expenses to see revenue, costs and estimated profit. Nothing is shown as zero until there are records.</p></Empty>}

      <section className="card card-pad">
        <div className="section-head"><div className="section-title">AI cost on Task Center runs</div><button className="text-btn small" onClick={() => setView("usage")}>Provider usage</button></div>
        <p className="small">{st.ai.tasks ? `$${st.ai.usd.toFixed(2)} across ${st.ai.tasks} tasks${st.ai.estimated ? " (part estimated from published prices)" : ""}` : "No AI cost reported on tasks in this period."} · {st.ai.perCompletedTaskUsd === null ? "No completed tasks" : `$${st.ai.perCompletedTaskUsd.toFixed(4)} per completed task`}</p>
        <p className="muted small">{METRIC_DEFINITIONS.taskAi}</p>
        {st.testRecordsIgnored > 0 && <p className="muted small">{st.testRecordsIgnored} test records in this period were left out.</p>}
      </section>

      <section className="card biz-table-card">
        <div className="section-head card-pad"><div className="section-title">Sales</div></div>
        {sales.length ? (
          <table className="table compact">
            <thead><tr><th>Date</th><th>Order</th><th>Product</th><th>Gross</th><th>Refunds</th><th>Fees</th><th>Net</th><th>Source</th></tr></thead>
            <tbody>{sales.map((s) => <tr key={s.id}><td>{s.date}</td><td className="small"><code>{s.orderRef}</code> <ProvChip p={s.provenance} /></td><td className="small">{s.productRef}</td><td>{money(s.grossCents, s.currency)}</td><td>{money(s.refundCents, s.currency)}</td><td>{money(s.feeCents, s.currency)}</td><td><b>{money(netCents(s), s.currency)}</b></td><td className="small">{s.verification === "verified" ? "Verified · " : "Entered · "}{s.source}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted small card-pad">No sales in this period.</p>}
      </section>

      <section className="card biz-table-card">
        <div className="section-head card-pad"><div className="section-title">Expenses</div></div>
        {expenses.length ? (
          <table className="table compact">
            <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Product</th><th>Amount</th><th>Basis</th></tr></thead>
            <tbody>{expenses.map((e) => <tr key={e.id}><td>{e.date}</td><td className="small">{e.vendor} <ProvChip p={e.provenance} /></td><td className="small">{EXPENSE_LABEL[e.category]}</td><td className="small">{e.productRef ?? "—"}</td><td>{money(e.amountCents, e.currency)}</td><td className="small">{e.basis === "estimated" ? "Estimate" : "Actual"}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted small card-pad">No expenses in this period.</p>}
      </section>

      {form === "sale" && <SaleForm data={data} testMode={testMode} onClose={() => setForm(null)} />}
      {form === "expense" && <ExpenseForm data={data} testMode={testMode} onClose={() => setForm(null)} />}
    </>
  );
}

type SyncState = { kind: "idle" } | { kind: "busy" } | { kind: "error"; error: string; unconfigured: boolean } | { kind: "plan"; feed: SalesFeed; plan: SyncPlan } | { kind: "done"; text: string };

/** Reads Stripe through the n8n sales feed, shows what would change, and records it only when Khaneil says so. */
function StripeSync({ data }: { data: BusinessData }) {
  const [s, setS] = useState<SyncState>({ kind: "idle" });
  const fetchNow = async () => {
    setS({ kind: "busy" });
    const r = syncRange(MAX_RANGE_DAYS);
    const a = await fetchStripeSales(r.since, r.until);
    if (a.state !== "ok") return setS({ kind: "error", error: a.error, unconfigured: a.state === "unconfigured" });
    setS({ kind: "plan", feed: a.feed, plan: planSync(a.feed, data.sales, ME, nowIso()) });
  };
  const record = () => {
    if (s.kind !== "plan") return;
    const store = businessStore();
    let saved = 0;
    const failed: string[] = [];
    for (const sale of s.plan.create) {
      const r = store.create("sales", sale);
      if (r.ok) saved++;
      else failed.push(r.error);
    }
    for (const u of s.plan.update) {
      const r = store.put("sales", u.sale, u.expectedRev);
      if (r.ok) saved++;
      else failed.push(r.error);
    }
    setS({ kind: "done", text: failed.length ? `Saved ${saved}. ${failed.length} couldn't be saved: ${failed[0]}` : `Saved ${saved} change${saved === 1 ? "" : "s"} from Stripe.` });
  };
  const changes = s.kind === "plan" ? s.plan.create.length + s.plan.update.length : 0;
  return (
    <section className="card card-pad biz-stripe">
      <div className="section-head">
        <div className="section-title">Stripe sales</div>
        <button className="btn" onClick={fetchNow} disabled={s.kind === "busy"}><Icon name="refresh" size={14} /> {s.kind === "busy" ? "Reading Stripe…" : "Sync from Stripe"}</button>
      </div>
      <p className="muted small">Reads paid checkouts from the last {MAX_RANGE_DAYS} days through the Atlas · Sales feed workflow in n8n. Read only: nothing in Stripe changes, and no buyer names or emails come into Atlas. You see what would change before anything is saved.</p>
      {s.kind === "error" && <div className={`task-callout ${s.unconfigured ? "warn" : "bad"}`} role="status"><b>{s.unconfigured ? "Not set up yet" : "Sync failed"}</b><span>{s.error}</span></div>}
      {s.kind === "done" && <div className="task-callout good" role="status"><span>{s.text}</span></div>}
      {s.kind === "plan" && (
        <div className="biz-stripe-plan">
          <p className="small">Stripe has {s.feed.sales.length} paid checkout{s.feed.sales.length === 1 ? "" : "s"} from {s.feed.since.slice(0, 10)} to {s.feed.until.slice(0, 10)}: <b>{s.plan.create.length} new</b>, {s.plan.update.length} refund update{s.plan.update.length === 1 ? "" : "s"}, {s.plan.unchanged} already in Atlas{s.plan.skipped.length ? `, ${s.plan.skipped.length} skipped` : ""}.{s.feed.dropped ? ` ${s.feed.dropped} unreadable rows were left out.` : ""}</p>
          {s.plan.create.length > 0 && (
            <table className="table compact">
              <thead><tr><th>Date</th><th>Checkout</th><th>Product</th><th>Gross</th><th>Refunds</th><th>Fees</th><th>Net</th></tr></thead>
              <tbody>{s.plan.create.map((x) => <tr key={x.orderRef}><td>{x.date}</td><td className="small"><code>{x.orderRef.slice(0, 18)}…</code></td><td className="small">{x.productRef}</td><td>{money(x.grossCents, x.currency)}</td><td>{money(x.refundCents, x.currency)}</td><td>{money(x.feeCents, x.currency)}</td><td><b>{money(netCents(x), x.currency)}</b></td></tr>)}</tbody>
            </table>
          )}
          {s.plan.skipped.length > 0 && <ul className="biz-list small">{s.plan.skipped.slice(0, 5).map((k) => <li key={k.orderRef}><code>{k.orderRef.slice(0, 18)}…</code> {k.reason}</li>)}</ul>}
          {s.plan.feesPending > 0 && <p className="muted small">{s.plan.feesPending} sale{s.plan.feesPending === 1 ? " has" : "s have"} no Stripe fee yet, so the fee is saved as 0 until Stripe settles it.</p>}
          <div className="task-actions">
            <button className="btn primary" onClick={record} disabled={!changes}>{changes ? `Record ${changes} change${changes === 1 ? "" : "s"}` : "Nothing new to record"}</button>
            <button className="btn" onClick={() => setS({ kind: "idle" })}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, def, v, strong = false }: { label: string; def: string; v: string; strong?: boolean }) {
  return <tr><td title={def}>{strong ? <b>{label}</b> : label} <small className="muted biz-def">{def.split(": ")[1]}</small></td><td className="num">{strong ? <b>{v}</b> : v}</td></tr>;
}

function SaleForm({ data, testMode, onClose }: { data: BusinessData; testMode: boolean; onClose: () => void }) {
  const [f, setF] = useState({ orderRef: "", productRef: "", customerId: "", date: today(), currency: "USD", gross: "", refunds: "", fees: "" });
  const [provenance, setProvenance] = useState<"real" | "test">(testMode ? "test" : "real");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = () => {
    const r = draftSale({ ...f, customerId: f.customerId || undefined, provenance, source }, data.sales, ME, nowIso());
    if (!r.ok) return setError(r.error);
    const s = businessStore().create("sales", r.value);
    if (!s.ok) return setError(s.error);
    onClose();
  };
  const products = data.products.filter((p) => p.provenance === provenance);
  const customers = data.customers.filter((c) => c.provenance === provenance);
  return (
    <Panel title="Record a sale" onClose={onClose}>
      <p className="muted small">Copy these from the payment provider's own record of the order. Atlas checks the numbers add up and refuses an order it already has.</p>
      <div className="task-row">
        <Field label="Order reference"><input value={f.orderRef} onChange={set("orderRef")} placeholder="e.g. pi_3P…" /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set("date")} /></Field>
      </div>
      <div className="task-row">
        <Field label="Product"><input list="biz-products" value={f.productRef} onChange={set("productRef")} /><datalist id="biz-products">{products.map((p) => <option key={p.id} value={p.productRef}>{p.title}</option>)}</datalist></Field>
        <Field label="Customer"><select value={f.customerId} onChange={set("customerId")}><option value="">Not linked</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <div className="task-row">
        <Field label="Currency"><input value={f.currency} onChange={set("currency")} maxLength={3} /></Field>
        <Field label="Gross"><input inputMode="decimal" value={f.gross} onChange={set("gross")} placeholder="49.00" /></Field>
      </div>
      <div className="task-row">
        <Field label="Refunds"><input inputMode="decimal" value={f.refunds} onChange={set("refunds")} placeholder="0.00" /></Field>
        <Field label="Fees"><input inputMode="decimal" value={f.fees} onChange={set("fees")} placeholder="1.72" /></Field>
      </div>
      <ProvenanceFields provenance={provenance} setProvenance={setProvenance} source={source} setSource={setSource} testMode={testMode} />
      <ErrorLine error={error} />
      <div className="task-actions"><button className="btn primary" onClick={submit}>Save sale</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Panel>
  );
}

function ExpenseForm({ data, testMode, onClose }: { data: BusinessData; testMode: boolean; onClose: () => void }) {
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("software");
  const [date, setDate] = useState(today());
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [basis, setBasis] = useState<"actual" | "estimated">("actual");
  const [productRef, setProductRef] = useState("");
  const [provenance, setProvenance] = useState<"real" | "test">(testMode ? "test" : "real");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const cents = parseMoney(amount);
    if (!vendor.trim()) return setError("Name the vendor.");
    if (cents === null || cents <= 0) return setError("The amount must be more than zero, with at most two decimals.");
    if (!/^[A-Z]{3}$/.test(currency.toUpperCase())) return setError("Use a three-letter currency code.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Use a date like 2026-11-16.");
    if (provenance === "real" && !source.trim()) return setError("Say where this expense can be checked (invoice, statement).");
    const at = nowIso();
    const e: Expense = { id: newId("exp"), provenance, source: source.trim() || "Test data", createdAt: at, createdBy: ME, updatedAt: at, date, vendor: vendor.trim(), category, basis, currency: currency.toUpperCase(), amountCents: cents, ...(productRef ? { productRef } : {}), rev: 1 };
    const r = businessStore().create("expenses", e);
    if (!r.ok) return setError(r.error);
    onClose();
  };
  return (
    <Panel title="Record an expense" onClose={onClose}>
      <div className="task-row">
        <Field label="Vendor"><input value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="task-row">
        <Field label="Category"><select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_LABEL[c]}</option>)}</select></Field>
        <Field label="For product (optional)"><select value={productRef} onChange={(e) => setProductRef(e.target.value)}><option value="">General</option>{data.products.filter((p) => p.provenance === provenance).map((p) => <option key={p.id} value={p.productRef}>{p.title}</option>)}</select></Field>
      </div>
      <div className="task-row">
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} /></Field>
        <Field label="Amount"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="Basis"><select value={basis} onChange={(e) => setBasis(e.target.value as "actual" | "estimated")}><option value="actual">Actual (invoice or statement)</option><option value="estimated">My estimate</option></select></Field>
      <ProvenanceFields provenance={provenance} setProvenance={setProvenance} source={source} setSource={setSource} testMode={testMode} />
      <ErrorLine error={error} />
      <div className="task-actions"><button className="btn primary" onClick={submit}>Save expense</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Panel>
  );
}
