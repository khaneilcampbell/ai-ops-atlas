import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { isTauri } from "../../lib/env";
import { load, save } from "../../lib/storage";
import { useAtlas } from "../../state";
import { useTasks } from "../../tasks/store";
import { useRuns } from "../../workflows/runs";
import { retentionSweep } from "../../business/access";
import { overview, type BusinessFilter } from "../../business/dashboard";
import { monthOf } from "../../business/finance";
import { takeBusinessTab, type BusinessTab } from "../../business/focus";
import { businessStore, useBusiness } from "../../business/store";
import { GOAL_DOMAINS, type GoalDomain, type Provenance } from "../../business/types";
import { AdvisorTab } from "./AdvisorTab";
import { FinanceTab } from "./FinanceTab";
import { GoalsTab } from "./GoalsTab";
import { ImpactTab } from "./ImpactTab";
import { OverviewTab } from "./OverviewTab";
import { PipelineTab } from "./PipelineTab";
import { ProductsTab } from "./ProductsTab";
import { seedTestData } from "./testData";
import { DOMAIN_LABEL } from "./parts";
import "../../styles/tasks.css";
import "../../styles/business.css";

// Business: Benjaire's goals, pipeline, products, money and advice, in Business Operations HQ.
// Everything is worked out from records kept on this device (src/business); no model is called.

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "goals", label: "Goals" },
  { id: "pipeline", label: "Leads & customers" },
  { id: "products", label: "Products" },
  { id: "finance", label: "Revenue & costs" },
  { id: "impact", label: "Agent impact" },
  { id: "advisor", label: "Advisor" },
] as const;
type Tab = BusinessTab;

export function BusinessView() {
  const data = useBusiness();
  const tasks = useTasks();
  const runs = useRuns();
  const { catalog } = useAtlas();
  const [tab, setTab] = useState<Tab>(() => takeBusinessTab() ?? load<Tab>("businessTab", "overview"));
  const month = monthOf(new Date());
  const [filter, setFilterState] = useState<BusinessFilter>({ period: month, product: "", area: "", source: "all", provenance: load<Provenance>("businessMode", "real") });
  const setFilter = (p: Partial<BusinessFilter>) => setFilterState((f) => ({ ...f, ...p }));
  const go = (t: Tab) => { setTab(t); save("businessTab", t); };

  // Retention: lost leads past 180 days go, do-not-contact details are cleared.
  useEffect(() => {
    const s = businessStore();
    const snap = s.snapshot();
    const sweep = retentionSweep(snap.leads, snap.customers, Date.now());
    for (const id of sweep.removeLeads) s.remove("leads", id);
    for (const l of sweep.scrubLeads) s.put("leads", l, l.rev);
    for (const c of sweep.scrubCustomers) s.put("customers", c, c.rev);
  }, []);

  const o = useMemo(() => overview(data, tasks, runs, filter), [data, tasks, runs, filter]);
  const test = filter.provenance === "test";
  const products = [...new Map(data.products.filter((p) => p.provenance === filter.provenance).map((p) => [p.productRef, p.title])).entries()];
  const testCount = Object.values(data).reduce((n, list) => n + (list as { provenance: string }[]).filter((r) => r.provenance === "test").length, 0);
  const scope = isTauri() ? "Saved on this Mac only" : "Saved in this browser only";
  const agentName = (id: string) => catalog.agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="page business">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Business Operations HQ</div>
          <h1>How Benjaire is doing, from real records.</h1>
          <p className="lede">Goals, leads, customers, products, revenue and costs in one place. Every figure is worked out from records you enter or import; nothing is estimated by a model, and anything that can't be measured yet says so.</p>
        </div>
        <div className="seg" role="tablist" aria-label="Which records">
          <button role="tab" aria-selected={!test} className={!test ? "on" : ""} onClick={() => { setFilter({ provenance: "real", product: "" }); save("businessMode", "real"); }}>Real records</button>
          <button role="tab" aria-selected={test} className={test ? "on" : ""} onClick={() => { setFilter({ provenance: "test", product: "" }); save("businessMode", "test"); }}>Test data</button>
        </div>
      </div>

      {test && (
        <div className="task-callout warn biz-test-banner" role="status">
          <b>TEST DATA. Nothing on this screen is real.</b>
          <span>Test records are kept apart from real ones and never count toward a real figure, goal or report. {testCount} test records on this device.</span>
          <div className="task-actions">
            {testCount === 0 && <button className="btn" onClick={() => seedTestData(businessStore())}>Add labelled test data</button>}
            {testCount > 0 && <button className="btn" onClick={() => businessStore().clearTestData()}>Remove all test data</button>}
          </div>
        </div>
      )}

      <div className="task-strip">
        <span className="task-conn"><span className="dot" /> <b>{scope}</b> · not synced</span>
        <span className="task-conn warn"><span className="dot" /> <b>Payments</b> · not connected, add sales by hand</span>
        <span className="task-conn"><span className="dot" /> <b>Inquiries</b> · from the Inquiry to Client inbox</span>
        <span className="task-conn"><span className="dot" /> <b>Research</b> · Product Lab briefs</span>
      </div>

      <div className="filters" role="search">
        <label className="field"><span>From</span><input type="date" value={filter.period.from} max={filter.period.to} onChange={(e) => e.target.value && setFilter({ period: { ...filter.period, from: e.target.value } })} aria-label="From" /></label>
        <label className="field"><span>To</span><input type="date" value={filter.period.to} min={filter.period.from} onChange={(e) => e.target.value && setFilter({ period: { ...filter.period, to: e.target.value } })} aria-label="To" /></label>
        <label className="field"><span>Product</span><select value={filter.product} onChange={(e) => setFilter({ product: e.target.value })}><option value="">All</option>{products.map(([ref, t]) => <option key={ref} value={ref}>{t}</option>)}</select></label>
        <label className="field"><span>Business area</span><select value={filter.area} onChange={(e) => setFilter({ area: e.target.value as GoalDomain | "" })}><option value="">All</option>{GOAL_DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}</select></label>
        <label className="field"><span>Sales source</span><select value={filter.source} onChange={(e) => setFilter({ source: e.target.value as BusinessFilter["source"] })}><option value="all">All</option><option value="verified">Verified with provider</option><option value="manual">Entered by hand</option></select></label>
        {(filter.period.from !== month.from || filter.period.to !== month.to || filter.product || filter.area || filter.source !== "all") && (
          <button className="text-btn" onClick={() => setFilter({ period: month, product: "", area: "", source: "all" })}>Reset to this month</button>
        )}
      </div>

      <div className="seg biz-tabs" role="tablist" aria-label="Business views">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)}>{t.label}</button>)}
      </div>

      {tab === "overview" && <OverviewTab o={o} filter={filter} go={go} />}
      {tab === "goals" && <GoalsTab o={o} data={data} filter={filter} agentName={agentName} />}
      {tab === "pipeline" && <PipelineTab data={data} o={o} filter={filter} agentName={agentName} />}
      {tab === "products" && <ProductsTab data={data} filter={filter} />}
      {tab === "finance" && <FinanceTab data={data} o={o} filter={filter} />}
      {tab === "impact" && <ImpactTab data={data} filter={filter} />}
      {tab === "advisor" && <AdvisorTab data={data} filter={filter} />}
      <p className="muted small biz-foot"><Icon name="lock" size={12} /> Business records stay on this device. Personal details (names, contact references) are never sent to the site, an agent or a model.</p>
    </div>
  );
}
