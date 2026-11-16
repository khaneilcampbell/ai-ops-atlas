import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useInquiries } from "../../inquiries/client";
import { newId } from "../../tasks/lifecycle";
import type { BusinessFilter, Overview } from "../../business/dashboard";
import { leadFromInquiry, unconvertedInquiries } from "../../business/intake";
import { canContact, customerFromLead, followUps, money, moveLead, netCents, DEFAULT_PIPELINE } from "../../business/revenue";
import { businessStore } from "../../business/store";
import { CUSTOMER_STATES, STAGE_LABEL, type BusinessData, type ContactPreferences, type Customer, type CustomerState, type Interaction, type Lead, type LeadStage } from "../../business/types";
import { useAtlas } from "../../state";
import { Empty, ErrorLine, Field, ME, nowIso, Panel, pct, ProvChip, ProvenanceFields } from "./parts";

const CUSTOMER_LABEL: Record<CustomerState, string> = { active: "Active", at_risk: "At risk", churned: "Churned" };
const DAY = 86_400_000;

/** Retention indicators from the customer's own real purchases. */
export function retention(c: Customer, data: BusinessData, now = Date.now()) {
  const sales = data.sales.filter((s) => s.customerId === c.id && s.provenance === c.provenance);
  const last = sales.map((s) => s.date).sort().pop() ?? null;
  const byCur: Record<string, number> = {};
  for (const s of sales) byCur[s.currency] = (byCur[s.currency] ?? 0) + netCents(s);
  return { purchases: sales.length, orderRefs: sales.map((s) => s.orderRef), lastPurchase: last, daysSince: last ? Math.floor((now - Date.parse(last)) / DAY) : null, repeat: sales.length > 1, spent: Object.entries(byCur).map(([cur, cents]) => money(cents, cur)).join(" · ") || "None" };
}

export function PipelineTab({ data, o, filter, agentName }: { data: BusinessData; o: Overview; filter: BusinessFilter; agentName: (id: string) => string }) {
  const [form, setForm] = useState(false);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inquiries = useInquiries();
  const leads = data.leads.filter((l) => l.provenance === filter.provenance);
  const customers = data.customers.filter((c) => c.provenance === filter.provenance);
  const fresh = filter.provenance === "real" ? unconvertedInquiries(inquiries.inquiries, data.leads) : [];
  const due = followUps(leads, Date.now()).filter((f) => f.due);
  const lead = data.leads.find((l) => l.id === openLead);
  const customer = data.customers.find((c) => c.id === openCustomer);

  const importInquiry = (id: string) => {
    const inq = inquiries.inquiries.find((i) => i.id === id);
    if (!inq) return;
    const r = leadFromInquiry(inq, businessStore().snapshot().leads, ME, nowIso());
    if (!r.ok) return setError(r.error);
    const s = businessStore().create("leads", r.value);
    setError(s.ok ? null : s.error);
  };

  return (
    <>
      <div className="biz-actions-row">
        <p className="muted small">Leads move New lead, Qualified, Contacted, Proposal, then Won or Lost. Contact needs the person's consent; anyone who asked not to be contacted is never listed for follow-up.</p>
        <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" size={14} /> New lead</button>
      </div>
      <ErrorLine error={error} />

      {filter.provenance === "real" && (
        <section className="card card-pad">
          <div className="section-title">New website inquiries</div>
          {inquiries.state === "ready" ? (
            fresh.length ? (
              <ul className="biz-list">{fresh.slice(0, 8).map((i) => <li key={i.id}><b>{i.category_label}</b> <span className="muted small">{i.received_at.slice(0, 10)} · {i.company || "No company"}</span> <button className="btn small" onClick={() => importInquiry(i.id)}>Add as lead</button></li>)}</ul>
            ) : <p className="muted small">Every inquiry in the inbox is already a lead.</p>
          ) : <p className="muted small">{inquiries.state === "loading" ? "Checking the inbox…" : (inquiries.message ?? "The inquiry inbox isn't available here.")} Leads can still be added by hand.</p>}
        </section>
      )}

      {due.length > 0 && (
        <div className="task-callout warn"><b>{due.length} follow-up{due.length === 1 ? "" : "s"} due</b><span>{due.map((f) => `${f.lead.name} (${f.lead.followUpDate})`).join(", ")}. Send them from your own mail and record each one.</span></div>
      )}

      <section className="card biz-table-card">
        <div className="section-head card-pad"><div className="section-title">Leads</div><span className="muted small">Win rate {o.conversion.winRate === null ? "not available yet" : pct(o.conversion.winRate)} · {o.conversion.stepRates.map((s) => `${STAGE_LABEL[s.from]} to ${STAGE_LABEL[s.to]} ${s.rate === null ? "n/a" : pct(s.rate)}`).join(" · ")}</span></div>
        {leads.length ? (
          <table className="table compact">
            <thead><tr><th>Lead</th><th>Stage</th><th>Interest</th><th>Source</th><th>Agent</th><th>Follow-up</th><th>Contact</th></tr></thead>
            <tbody>{leads.map((l) => (
              <tr key={l.id} onClick={() => setOpenLead(l.id)}>
                <td><button className="text-btn inline name">{l.name}</button> <ProvChip p={l.provenance} /></td>
                <td><span className={`status task-status ${l.stage === "won" ? "done" : l.stage === "lost" ? "retired" : "active"}`}>{STAGE_LABEL[l.stage]}</span></td>
                <td className="small">{l.productInterest || "—"}</td>
                <td className="small">{l.acquisitionSource}</td>
                <td className="small">{l.agentId ? agentName(l.agentId) : "—"}</td>
                <td className="small">{l.followUpDate ?? "—"}</td>
                <td className="small">{l.preferences.doNotContact ? "Do not contact" : canContact(l) ? "Allowed" : "No consent"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty title="No leads yet"><p className="muted">Add a website inquiry as a lead, or add one by hand.</p></Empty>}
      </section>

      <section className="card biz-table-card">
        <div className="section-head card-pad"><div className="section-title">Customers</div><span className="muted small">Lead to customer {o.leadToCustomer && typeof o.leadToCustomer === "number" ? pct(o.leadToCustomer) : "not available yet"}</span></div>
        {customers.length ? (
          <table className="table compact">
            <thead><tr><th>Customer</th><th>Status</th><th>Products</th><th>Purchases</th><th>Last purchase</th><th>Net spent</th></tr></thead>
            <tbody>{customers.map((c) => { const r = retention(c, data); return (
              <tr key={c.id} onClick={() => setOpenCustomer(c.id)}>
                <td><button className="text-btn inline name">{c.name}</button> <ProvChip p={c.provenance} /></td>
                <td className="small">{CUSTOMER_LABEL[c.lifecycle]}</td>
                <td className="small">{c.productsOwned.join(", ") || "—"}</td>
                <td className="small">{r.purchases}{r.repeat ? " · repeat" : ""}</td>
                <td className="small">{r.lastPurchase ? `${r.lastPurchase} (${r.daysSince} d)` : "None recorded"}</td>
                <td className="small">{r.spent}</td>
              </tr>
            ); })}</tbody>
          </table>
        ) : <p className="muted small card-pad">A lead becomes a customer when it's won.</p>}
      </section>

      {form && <LeadForm testMode={filter.provenance === "test"} onClose={() => setForm(false)} />}
      {lead && <LeadDetail lead={lead} onClose={() => setOpenLead(null)} onCustomer={(id) => { setOpenLead(null); setOpenCustomer(id); }} />}
      {customer && <CustomerDetail customer={customer} data={data} onClose={() => setOpenCustomer(null)} />}
    </>
  );
}

function PrefsFields({ p, set }: { p: ContactPreferences; set: (p: ContactPreferences) => void }) {
  return (
    <fieldset className="task-field">
      <span>Consent and contact preferences</span>
      <label className="task-check"><input type="checkbox" checked={p.contactConsent} onChange={(e) => set({ ...p, contactConsent: e.target.checked })} /> Agreed to be contacted about this</label>
      <label className="task-check"><input type="checkbox" checked={p.marketingOptIn} onChange={(e) => set({ ...p, marketingOptIn: e.target.checked })} /> Opted in to marketing</label>
      <label className="task-check"><input type="checkbox" checked={p.doNotContact} onChange={(e) => set({ ...p, doNotContact: e.target.checked })} /> Asked not to be contacted</label>
      <select value={p.channel} onChange={(e) => set({ ...p, channel: e.target.value as ContactPreferences["channel"] })} aria-label="Preferred channel"><option value="email">Email</option><option value="phone">Phone</option><option value="none">No channel</option></select>
    </fieldset>
  );
}

function LeadForm({ testMode, onClose }: { testMode: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [contactRef, setContactRef] = useState("");
  const [sourceOf, setSourceOf] = useState("Referral");
  const [interest, setInterest] = useState("");
  const [follow, setFollow] = useState("");
  const [prefs, setPrefs] = useState<ContactPreferences>({ contactConsent: false, marketingOptIn: false, doNotContact: false, channel: "email" });
  const [provenance, setProvenance] = useState<"real" | "test">(testMode ? "test" : "real");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim()) return setError("Give the lead a name or label.");
    if (provenance === "real" && !source.trim()) return setError("Say where this lead came from, so it can be checked.");
    const at = nowIso();
    const lead: Lead = {
      id: newId("lead"), provenance, source: source.trim() || "Test data", createdAt: at, createdBy: ME, updatedAt: at,
      name: name.trim(), contactRef: contactRef.trim() || "Not recorded", acquisitionSource: sourceOf.trim() || "Unknown", productInterest: interest.trim(), stage: "new",
      ...(follow ? { followUpDate: follow } : {}), interactions: [], transitions: [{ from: null, to: "new", at, actor: ME }], preferences: prefs, rev: 1,
    };
    const r = businessStore().create("leads", lead);
    if (!r.ok) return setError(r.error);
    onClose();
  };
  return (
    <Panel title="New lead" onClose={onClose}>
      <Field label="Name or label"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
      <Field label="Contact reference" hint="Where to find their details (a CRM id or 'email on file'). Avoid pasting contact details here."><input value={contactRef} onChange={(e) => setContactRef(e.target.value)} maxLength={160} /></Field>
      <div className="task-row">
        <Field label="Acquisition source"><input value={sourceOf} onChange={(e) => setSourceOf(e.target.value)} /></Field>
        <Field label="Product interest"><input value={interest} onChange={(e) => setInterest(e.target.value)} /></Field>
      </div>
      <Field label="Follow-up date"><input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></Field>
      <PrefsFields p={prefs} set={setPrefs} />
      <ProvenanceFields provenance={provenance} setProvenance={setProvenance} source={source} setSource={setSource} testMode={testMode} />
      <ErrorLine error={error} />
      <div className="task-actions"><button className="btn primary" onClick={submit}>Save lead</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Panel>
  );
}

function LeadDetail({ lead, onClose, onCustomer }: { lead: Lead; onClose: () => void; onCustomer: (id: string) => void }) {
  const { catalog } = useAtlas();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<Interaction["kind"]>("email");
  const [summary, setSummary] = useState("");
  const save = (next: Lead) => { const r = businessStore().put("leads", next, lead.rev); setError(r.ok ? null : r.error); return r.ok; };
  const move = (to: LeadStage) => { const r = moveLead(lead, to, ME, nowIso(), note); if (!r.ok) return setError(r.error); if (save(r.value)) setNote(""); };
  const convert = () => {
    const c = customerFromLead(lead, ME, nowIso());
    if (!c.ok) return setError(c.error);
    const s = businessStore().create("customers", c.value);
    if (!s.ok) return setError(s.error);
    const fresh = businessStore().snapshot().leads.find((l) => l.id === lead.id)!;
    businessStore().put("leads", { ...fresh, customerId: c.value.id, updatedAt: nowIso() }, fresh.rev);
    onCustomer(c.value.id);
  };
  return (
    <Panel title={lead.name} eyebrow={`Lead · ${STAGE_LABEL[lead.stage]}`} onClose={onClose}>
      <dl className="biz-dl">
        <dt>Lead id</dt><dd><code>{lead.id}</code> <ProvChip p={lead.provenance} /></dd>
        <dt>Contact</dt><dd>{lead.contactRef}</dd>
        <dt>Source</dt><dd>{lead.acquisitionSource} · {lead.source}</dd>
        <dt>Interest</dt><dd>{lead.productInterest || "—"}</dd>
        {lead.lostReason && <><dt>Lost because</dt><dd>{lead.lostReason}</dd></>}
      </dl>
      {DEFAULT_PIPELINE.transitions[lead.stage].length > 0 && (
        <section>
          <div className="section-title">Move</div>
          <div className="task-artifact-form">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required when lost)" />
            {DEFAULT_PIPELINE.transitions[lead.stage].map((s) => <button key={s} className="btn" onClick={() => move(s)}>{STAGE_LABEL[s]}</button>)}
          </div>
        </section>
      )}
      {lead.stage === "won" && !lead.customerId && <button className="btn primary" onClick={convert}>Make customer</button>}
      <div className="task-row">
        <Field label="Follow-up date"><input type="date" value={lead.followUpDate ?? ""} onChange={(e) => save({ ...lead, followUpDate: e.target.value || undefined, updatedAt: nowIso() })} /></Field>
        <Field label="Assigned agent"><select value={lead.agentId ?? ""} onChange={(e) => save({ ...lead, agentId: e.target.value || undefined, updatedAt: nowIso() })}><option value="">None</option>{catalog.agents.filter((a) => a.status !== "retired").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      </div>
      <PrefsFields p={lead.preferences} set={(p) => save({ ...lead, preferences: p, updatedAt: nowIso() })} />
      <section>
        <div className="section-title">Interactions</div>
        {lead.interactions.length ? <ol className="task-events">{lead.interactions.map((i) => <li key={i.id}><b>{i.kind}</b> {i.summary} <span className="muted small">{i.at.slice(0, 16).replace("T", " ")} · {i.actor.name}</span></li>)}</ol> : <p className="muted small">None recorded.</p>}
        <div className="task-artifact-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as Interaction["kind"])}>{["email", "call", "meeting", "note"].map((k) => <option key={k}>{k}</option>)}</select>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened (no contact details)" maxLength={300} />
          <button className="btn" onClick={() => { if (!summary.trim()) return; if (save({ ...lead, interactions: [...lead.interactions, { id: newId("int"), at: nowIso(), kind, summary: summary.trim(), actor: ME }], updatedAt: nowIso() })) setSummary(""); }}>Add</button>
        </div>
      </section>
      <section>
        <div className="section-title">Stage history</div>
        <ol className="task-events">{lead.transitions.map((t, i) => <li key={i}>{t.from ? `${STAGE_LABEL[t.from]} to ` : ""}{STAGE_LABEL[t.to]} <span className="muted small">{t.at.slice(0, 16).replace("T", " ")} · {t.actor.name}{t.note ? ` · ${t.note}` : ""}</span></li>)}</ol>
      </section>
      <ErrorLine error={error} />
      <div className="task-actions"><button className="btn" onClick={() => { if (window.confirm?.("Delete this lead and its history from this device?") ?? true) { businessStore().remove("leads", lead.id); onClose(); } }}>Delete lead</button></div>
    </Panel>
  );
}

function CustomerDetail({ customer, data, onClose }: { customer: Customer; data: BusinessData; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [product, setProduct] = useState("");
  const save = (next: Customer) => { const r = businessStore().put("customers", next, customer.rev); setError(r.ok ? null : r.error); return r.ok; };
  const r = retention(customer, data);
  return (
    <Panel title={customer.name} eyebrow="Customer" onClose={onClose}>
      <dl className="biz-dl">
        <dt>Customer id</dt><dd><code>{customer.id}</code> <ProvChip p={customer.provenance} /></dd>
        <dt>Contact</dt><dd>{customer.contactRef}</dd>
        <dt>Purchases</dt><dd>{r.purchases ? r.orderRefs.join(", ") : "None recorded"}</dd>
        <dt>Retention</dt><dd>{r.lastPurchase ? `Last purchase ${r.lastPurchase}, ${r.daysSince} days ago${r.repeat ? ", repeat buyer" : ""}` : "No purchase recorded yet"} · {customer.supportInteractions.length} support contacts</dd>
        <dt>Net spent</dt><dd>{r.spent}</dd>
      </dl>
      <Field label="Lifecycle"><select value={customer.lifecycle} onChange={(e) => save({ ...customer, lifecycle: e.target.value as CustomerState, updatedAt: nowIso() })}>{CUSTOMER_STATES.map((s) => <option key={s} value={s}>{CUSTOMER_LABEL[s]}</option>)}</select></Field>
      <section>
        <div className="section-title">Products owned</div>
        <p className="small">{customer.productsOwned.join(", ") || "None"}</p>
        <div className="task-artifact-form"><input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product reference" /><button className="btn" onClick={() => { if (product.trim() && save({ ...customer, productsOwned: [...new Set([...customer.productsOwned, product.trim()])], updatedAt: nowIso() })) setProduct(""); }}>Add</button></div>
      </section>
      <section>
        <div className="section-title">Support interactions</div>
        {customer.supportInteractions.length ? <ol className="task-events">{customer.supportInteractions.map((i) => <li key={i.id}>{i.summary} <span className="muted small">{i.at.slice(0, 10)}</span></li>)}</ol> : <p className="muted small">None recorded.</p>}
        <div className="task-artifact-form"><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What they needed" maxLength={300} /><button className="btn" onClick={() => { if (summary.trim() && save({ ...customer, supportInteractions: [...customer.supportInteractions, { id: newId("int"), at: nowIso(), kind: "note", summary: summary.trim(), actor: ME }], updatedAt: nowIso() })) setSummary(""); }}>Add</button></div>
      </section>
      <ErrorLine error={error} />
    </Panel>
  );
}
