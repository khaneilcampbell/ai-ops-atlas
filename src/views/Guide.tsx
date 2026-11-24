import { useMemo } from "react";
import { guidePlaces, operation } from "../guide/guide";
import { openLibrary } from "../library/client";
import { SECTIONS, SIDEBAR_SECTIONS } from "../lib/sections";
import { useAtlas, type View } from "../state";
import { PAGE_TABS } from "./Agents";
import "../styles/guide.css";

/** Top switch first (Map, Mission Control, Business), then the sidebar in its own order. */
const ORDER = ["map", "overview", "business", ...SIDEBAR_SECTIONS.map((s) => s.id)];
const LABEL: Record<string, string> = { overview: "Mission Control", automations: "Automations", workspace: "Hub (Workspace)" };

/**
 * Intel → Overview: a guide to Atlas. The places and tabs come from the sidebar's own sections and
 * the Agents and Automations page tabs; the operating structure and counts come from the catalog.
 * Read-only.
 */
export function GuideView() {
  const { catalog, setView } = useAtlas();
  const places = useMemo(() => guidePlaces(SECTIONS, ORDER, PAGE_TABS), []);
  const op = useMemo(() => operation(catalog.agents), [catalog]);
  const open = (id: string, view?: string) => {
    if (id === "library") { setView("map"); openLibrary(); } else if (view) setView(view as View);
  };

  return (
    <div className="page guide">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Intel · Overview</div>
          <h1>How Atlas works</h1>
          <p className="lede">A guide to every part of Atlas: what it is, how to use it, and how your agents are organised. It reads the same data as the tabs, so it stays current.</p>
        </div>
      </div>

      <div className="grid tiles" style={{ marginBottom: 16 }}>
        <div className="card tile accent"><div className="eyebrow">Projects</div><div className="num">{catalog.projects.length}</div><div className="sub">in the catalog</div></div>
        <div className="card tile"><div className="eyebrow">Roles</div><div className="num">{op.leads.length}</div><div className="sub">one lead agent each</div></div>
        <div className="card tile"><div className="eyebrow">Agents</div><div className="num">{op.agents}</div><div className="sub">in the catalog</div></div>
        <div className="card tile"><div className="eyebrow">Automations</div><div className="num">{op.automations}</div><div className="sub">{op.orphans ? `${op.orphans} without an owner` : "each owned by one agent"}</div></div>
      </div>

      <section className="card card-pad guide-ops" aria-labelledby="guide-ops">
        <h2 id="guide-ops">How the operation works</h2>
        <ol className="guide-rules">
          <li><b>You approve.</b> Anything that sends, publishes, spends money or changes production waits for your OK.</li>
          <li><b>{op.coordinator} coordinates.</b> Turns your goals into plans in Tasks, keeps the agent registry current and proposes at most one new agent a week.</li>
          <li><b>One lead agent per role.</b> Each role below has a single lead who answers for its work.</li>
          <li><b>Skills run inside a lead's run.</b> They are steps of one agent, not separate agents. {op.withSkills.length ? `Today only ${op.withSkills.join(" and ")} ${op.withSkills.length === 1 ? "has" : "have"} skills.` : "No lead has skills today."}</li>
          <li><b>Automations are workflows owned by one agent.</b> n8n or GitHub workflows that do the fixed steps; the owner answers for them.</li>
          <li><b>Helper agents only when they run on their own schedule.</b> Otherwise the work is a skill or an automation of the lead.</li>
        </ol>
        <table className="table guide-leads">
          <caption className="sr-only">Roles and their lead agents</caption>
          <thead><tr><th>Role</th><th>Lead</th><th>Skills</th><th><span className="guide-wide">Automations</span><span className="guide-narrow">Auto</span></th><th>Helpers</th></tr></thead>
          <tbody>
            {op.leads.map((l) => (
              <tr key={l.roleId}>
                <td><b>{l.role}</b><div className="small muted">{l.purpose}</div></td>
                <td>{l.lead}</td>
                <td>{l.skills || "–"}</td>
                <td>{l.automations || "–"}</td>
                <td>{l.helpers || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h2 className="guide-places-title">Where things are</h2>
      <div className="guide-places">
        {places.map((p) => (
          <section key={p.id} className="card card-pad guide-place" aria-labelledby={`guide-${p.id}`}>
            <div className="guide-place-head">
              <h3 id={`guide-${p.id}`} className="grow">{LABEL[p.id] ?? p.label}</h3>
              <button className="text-btn small" onClick={() => open(p.id, p.open)}>Open →</button>
            </div>
            <p>{p.what}</p>
            <p className="muted">{p.how}</p>
            {p.tabs.length > 0 && (
              <dl className="guide-tabs">
                {p.tabs.map((t) => (
                  <div key={t.id}><dt>{t.label}</dt><dd>{t.text}</dd></div>
                ))}
              </dl>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
