import type { Agent } from "../catalog/types";
import { isAiAgent, type ServiceUse } from "../catalog/roles";
import { useAtlas } from "../state";
import { Icon } from "./Icon";

/** Operational context from declared responsibilities; no simulated run progress or handoffs. */
export function ToolWorkflow({ service, projectAgents }: { service: ServiceUse; projectAgents: Agent[] }) {
  const { select } = useAtlas();
  const outcomes = [...new Set(service.users.flatMap(a => a.registry?.mission?.outcomes ?? []))];
  const agentLink = (agent: Agent) => <button className="text-btn" key={agent.id} onClick={() => select({ kind: "agent", id: agent.id })}>{agent.name} →</button>;
  return <div className="tool-operations">
    {outcomes.length > 0 && <section><div className="section-title">Business outcomes</div><ul className="tool-outcomes">{outcomes.map(outcome => <li key={outcome}>{outcome}</li>)}</ul></section>}
    <section aria-label="Tool workflow"><div className="section-head"><div className="section-title">How the work happens</div><span className="source">Project records</span></div>
      {service.users.map((agent, index) => {
        const r = agent.registry;
        const needs = projectAgents.filter(a => r?.responsibilities?.dependencies?.includes(a.id));
        const supports = projectAgents.filter(a => a.id !== agent.id && a.registry?.responsibilities?.dependencies?.includes(agent.id));
        const tasks = r?.responsibilities?.tasks ?? [];
        const inputs = r?.responsibilities?.inputs ?? [];
        const outputs = r?.responsibilities?.outputs ?? [];
        const stages = r?.execution?.stages ?? [];
        const trigger = r?.execution?.schedule ?? agent.trigger;
        return <details key={agent.id} className="tool-workflow-step" open={index === 0}>
          <summary><Icon name={isAiAgent(agent) ? "agents" : "network"} size={16}/><span><strong>{agent.name}</strong><small>{r?.subcategory ?? (isAiAgent(agent) ? "AI agent" : "Automation")}</small></span></summary>
          <div className="tool-step-body">
            <p>{r?.mission?.problem ?? agent.purpose}</p>
            {trigger && <div className="tool-trigger"><Icon name="play" size={13}/><span><strong>When it runs</strong>{trigger}</span></div>}
            {tasks.length > 0 && <div><div className="section-title">Work performed</div><ul>{tasks.map(task => <li key={task}>{task}</li>)}</ul></div>}
            <div className="tool-io"><div><div className="section-title">Receives</div>{inputs.length ? <ul>{inputs.map(input => <li key={input}>{input}</li>)}</ul> : <p className="muted small">Inputs not documented yet.</p>}</div><div><div className="section-title">Produces</div>{outputs.length ? <ul>{outputs.map(output => <li key={output}>{output}</li>)}</ul> : <p className="muted small">Outputs not documented yet.</p>}</div></div>
            {stages.length > 0 && <div><div className="section-title">Workflow stages</div><ol>{stages.map(stage => <li key={stage}>{stage}</li>)}</ol></div>}
            {needs.length > 0 && <div><div className="section-title">Depends on</div><div className="tool-handoffs">{needs.map(agentLink)}</div></div>}
            {supports.length > 0 && <div><div className="section-title">Supports these workers</div><div className="tool-handoffs">{supports.map(agentLink)}</div></div>}
            {r?.governance?.approval && <div><div className="section-title">Approval</div><p>{r.governance.approval}</p></div>}
            <button className="ghost-btn" onClick={() => select({ kind: "agent", id: agent.id })}>Open worker details <span aria-hidden>→</span></button>
          </div>
        </details>;
      })}
    </section>
  </div>;
}
