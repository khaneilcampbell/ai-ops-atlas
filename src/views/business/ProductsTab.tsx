import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useAgentReports } from "../../reports/client";
import { PRODUCT_LAB_AGENT } from "../../reports/productLab";
import type { BusinessFilter } from "../../business/dashboard";
import { productRevenue } from "../../business/finance";
import { addFeedback, addListingVersion, approveListing, draftProduct, milestones, moveProduct, nextStages, productFromBrief, recordPublished } from "../../business/products";
import { money } from "../../business/revenue";
import { businessStore } from "../../business/store";
import { GATED_STAGES, PRODUCT_STAGES, PRODUCT_STAGE_LABEL, type BusinessData, type ProductOpportunity } from "../../business/types";
import { Empty, ErrorLine, Field, ME, nowIso, Panel, ProvChip, ProvenanceFields, today } from "./parts";

const LISTING_LABEL = { draft: "Draft", approved: "Approved, ready to publish", published: "Published" } as const;

function Stepper({ p }: { p: ProductOpportunity }) {
  const i = PRODUCT_STAGES.indexOf(p.stage);
  return (
    <ol className="biz-stepper" aria-label={`Stage: ${PRODUCT_STAGE_LABEL[p.stage]}`}>
      {PRODUCT_STAGES.map((s, j) => <li key={s} className={j < i ? "done" : j === i ? "on" : ""} title={GATED_STAGES[s] ? `Needs your approval: ${GATED_STAGES[s]}` : undefined}>{PRODUCT_STAGE_LABEL[s]}{GATED_STAGES[s] ? " ·" : ""}</li>)}
    </ol>
  );
}

export function ProductsTab({ data, filter }: { data: BusinessData; filter: BusinessFilter }) {
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const briefs = useAgentReports(PRODUCT_LAB_AGENT);
  const products = data.products.filter((p) => p.provenance === filter.provenance && (!filter.product || p.productRef === filter.product));
  const imported = new Set(data.products.map((p) => p.researchReportId));
  const fresh = filter.provenance === "real" ? briefs.reports.filter((r) => !imported.has(r.id)) : [];
  const product = data.products.find((p) => p.id === open);

  const importBrief = (id: number) => {
    const rep = briefs.reports.find((r) => r.id === id);
    if (!rep) return;
    const r = productFromBrief(rep, businessStore().snapshot().products, ME, nowIso());
    if (!r.ok) return setError(r.error);
    const s = businessStore().create("products", r.value);
    setError(s.ok ? null : s.error);
  };

  return (
    <>
      <div className="biz-actions-row">
        <p className="muted small">Every product follows Research, Evaluate, Approve, Build, Test, Launch, Measure. Build, Launch and Measure need your approval. Atlas can't publish to the marketplace; you publish, then record the live page here.</p>
        <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" size={14} /> New product</button>
      </div>
      <ErrorLine error={error} />
      {filter.provenance === "real" && (
        <section className="card card-pad">
          <div className="section-title">Product Lab research briefs</div>
          {briefs.state === "ready" ? (
            fresh.length ? <ul className="biz-list">{fresh.map((r) => { const b = r.body as { month?: string; top?: { title: string } }; return <li key={r.id}><b>{b.top?.title}</b> <span className="muted small">brief for {b.month}</span> <button className="btn small" onClick={() => importBrief(r.id)}>Add as opportunity</button></li>; })}</ul> : <p className="muted small">{briefs.reports.length ? "Every brief is already a product opportunity." : "No briefs posted yet."}</p>
          ) : <p className="muted small">{briefs.state === "loading" ? "Loading briefs…" : (briefs.message ?? "Briefs aren't available here.")}</p>}
        </section>
      )}
      {products.length ? (
        <div className="biz-cards">
          {products.map((p) => (
            <button key={p.id} className="card card-pad biz-product" onClick={() => setOpen(p.id)}>
              <div className="biz-goal-head"><b>{p.title}</b><ProvChip p={p.provenance} /><span className="chip">{LISTING_LABEL[p.listing.state]}</span></div>
              <Stepper p={p} />
              <div className="muted small">{p.researchScore !== undefined ? `Research score ${p.researchScore.toFixed(2)} of 5 · ` : ""}{p.pricingHypothesis || "No pricing hypothesis"} · {p.feedback.length} feedback notes</div>
            </button>
          ))}
        </div>
      ) : <Empty title="No product opportunities yet"><p className="muted">Add one from a Product Lab brief, or by hand.</p></Empty>}
      {form && <ProductForm data={data} testMode={filter.provenance === "test"} onClose={() => setForm(false)} />}
      {product && <ProductDetail product={product} data={data} onClose={() => setOpen(null)} />}
    </>
  );
}

function ProductForm({ data, testMode, onClose }: { data: BusinessData; testMode: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [price, setPrice] = useState("");
  const [provenance, setProvenance] = useState<"real" | "test">(testMode ? "test" : "real");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const r = draftProduct({ title, targetCustomer: target, pricingHypothesis: price, provenance, source }, data.products, ME, nowIso());
    if (!r.ok) return setError(r.error);
    const s = businessStore().create("products", r.value);
    if (!s.ok) return setError(s.error);
    onClose();
  };
  return (
    <Panel title="New product opportunity" onClose={onClose}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} /></Field>
      <Field label="Target customer"><input value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
      <Field label="Pricing hypothesis"><input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. $49 one-off" /></Field>
      <ProvenanceFields provenance={provenance} setProvenance={setProvenance} source={source} setSource={setSource} testMode={testMode} />
      <ErrorLine error={error} />
      <div className="task-actions"><button className="btn primary" onClick={submit}>Save</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Panel>
  );
}

function ListAdd({ label, items, onAdd }: { label: string; items: string[]; onAdd: (s: string) => void }) {
  const [v, setV] = useState("");
  return (
    <section>
      <div className="section-title">{label}</div>
      {items.length ? <ul className="biz-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted small">None yet.</p>}
      <div className="task-artifact-form"><input value={v} onChange={(e) => setV(e.target.value)} maxLength={200} /><button className="btn" onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(""); } }}>Add</button></div>
    </section>
  );
}

function ProductDetail({ product: p, data, onClose }: { product: ProductOpportunity; data: BusinessData; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [desc, setDesc] = useState(p.listing.versions[p.listing.versions.length - 1]?.description ?? "");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [url, setUrl] = useState("");
  const [launch, setLaunch] = useState(today());
  const [fb, setFb] = useState("");
  const save = (next: ProductOpportunity) => { const r = businessStore().put("products", next, p.rev); setError(r.ok ? null : r.error); return r.ok; };
  const apply = (r: { ok: true; value: ProductOpportunity } | { ok: false; error: string }) => (r.ok ? save(r.value) : (setError(r.error), false));
  const perf = productRevenue([p], data.sales.filter((s) => s.productRef === p.productRef && s.provenance === p.provenance).map((s) => ({ ...s, provenance: "real" as const })), data.expenses.filter((e) => e.productRef === p.productRef && e.provenance === p.provenance).map((e) => ({ ...e, provenance: "real" as const })));
  const edit = (patch: Partial<ProductOpportunity>) => save({ ...p, ...patch, updatedAt: nowIso() });
  return (
    <Panel title={p.title} eyebrow={`Product · ${PRODUCT_STAGE_LABEL[p.stage]}`} onClose={onClose}>
      <Stepper p={p} />
      <dl className="biz-dl">
        <dt>Product ref</dt><dd><code>{p.productRef}</code> <ProvChip p={p.provenance} /></dd>
        <dt>Source</dt><dd>{p.source}</dd>
        {p.researchScore !== undefined && <><dt>Research score</dt><dd>{p.researchScore.toFixed(2)} of 5 (Product Lab {p.researchMonth})</dd></>}
        <dt>Approvals</dt><dd>{p.approvals.length ? p.approvals.map((a) => `${PRODUCT_STAGE_LABEL[a.stage]} by ${a.actor.name} ${a.at.slice(0, 10)}`).join(" · ") : "None yet"}</dd>
      </dl>
      <section>
        <div className="section-title">Move</div>
        <div className="task-artifact-form">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approval note (optional)" />
          {nextStages(p).map((s) => <button key={s} className={`btn${GATED_STAGES[s] && PRODUCT_STAGES.indexOf(s) > PRODUCT_STAGES.indexOf(p.stage) ? " primary" : ""}`} onClick={() => apply(moveProduct(p, s, ME, nowIso(), note))}>{GATED_STAGES[s] && PRODUCT_STAGES.indexOf(s) > PRODUCT_STAGES.indexOf(p.stage) ? `Approve: ${PRODUCT_STAGE_LABEL[s]}` : PRODUCT_STAGE_LABEL[s]}</button>)}
        </div>
      </section>
      <div className="task-row">
        <Field label="Target customer"><input defaultValue={p.targetCustomer} onBlur={(e) => e.target.value !== p.targetCustomer && edit({ targetCustomer: e.target.value })} /></Field>
        <Field label="MVP estimate (hours)"><input inputMode="numeric" defaultValue={p.mvpHours ?? ""} onBlur={(e) => { const n = Number(e.target.value); if (e.target.value && Number.isFinite(n) && n >= 0) edit({ mvpHours: n }); }} /></Field>
      </div>
      <Field label="Pricing hypothesis"><input defaultValue={p.pricingHypothesis} onBlur={(e) => e.target.value !== p.pricingHypothesis && edit({ pricingHypothesis: e.target.value })} /></Field>
      <ListAdd label="Competitive research" items={p.competitors} onAdd={(s) => edit({ competitors: [...p.competitors, s] })} />
      <ListAdd label="Requirements" items={p.requirements} onAdd={(s) => edit({ requirements: [...p.requirements, s] })} />

      <section>
        <div className="section-title">Marketplace listing · {LISTING_LABEL[p.listing.state]}</div>
        {p.listing.versions.length ? <ul className="biz-list">{p.listing.versions.map((v) => <li key={v.version}>v{v.version} · {money(v.priceCents, v.currency)} · <span className="muted small">{v.description.slice(0, 120)} · {v.at.slice(0, 10)}</span></li>)}</ul> : <p className="muted small">No listing version yet.</p>}
        <Field label="Description"><textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div className="task-artifact-form"><input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price, e.g. 49" inputMode="decimal" /><input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} style={{ maxWidth: 70 }} /><button className="btn" onClick={() => apply(addListingVersion(p, desc, price, currency, ME, nowIso()))}>Save as new version</button></div>
        <div className="task-actions">
          {p.listing.state === "draft" && <button className="btn primary" onClick={() => apply(approveListing(p, ME, nowIso()))}>Approve listing</button>}
          {p.listing.state === "approved" && (
            <div className="task-artifact-form">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https:// live product page" />
              <input type="date" value={launch} onChange={(e) => setLaunch(e.target.value)} />
              <button className="btn primary" onClick={() => apply(recordPublished(p, url, launch, ME, nowIso()))}>I published it</button>
            </div>
          )}
          {p.listing.publishedUrl && <a href={p.listing.publishedUrl} target="_blank" rel="noreferrer">Live page</a>}
        </div>
        <p className="muted small">Atlas has no verified marketplace publishing connection, so it never publishes. Publish yourself, check the page is live, then record it.</p>
      </section>

      <section>
        <div className="section-title">Launch milestones</div>
        <ol className="task-events">{milestones(p).filter((m) => m.at).map((m) => <li key={m.stage}>{PRODUCT_STAGE_LABEL[m.stage]} <span className="muted small">{m.at!.slice(0, 10)}{m.approvedBy ? ` · approved by ${m.approvedBy}` : ""}</span></li>)}</ol>
      </section>
      <section>
        <div className="section-title">Sales performance and revenue contribution</div>
        {perf.length ? perf.map((r) => <p key={r.currency} className="small">{r.orders} orders · {money(r.netRevenueCents, r.currency)} net · {money(r.costCents, r.currency)} product costs</p>) : <p className="muted small">No sales recorded for this product.</p>}
      </section>
      <section>
        <div className="section-title">Customer feedback</div>
        {p.feedback.length ? <ol className="task-events">{p.feedback.map((f) => <li key={f.id}>{f.summary} <span className="muted small">{f.at.slice(0, 10)}</span></li>)}</ol> : <p className="muted small">None yet.</p>}
        <div className="task-artifact-form"><input value={fb} onChange={(e) => setFb(e.target.value)} placeholder="What a customer said" maxLength={600} /><button className="btn" onClick={() => { if (apply(addFeedback(p, fb, ME, nowIso()))) setFb(""); }}>Add</button></div>
      </section>
      <ErrorLine error={error} />
    </Panel>
  );
}
