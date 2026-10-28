import { useState } from 'react';
import { useAtlas } from '../../state';
import { agentsFor, allowedStatuses, departments, statuses, templates, type CommandAgent, type AgentTask, type Command } from './model';
import { dispatch, useCommand } from './store';
import './style.css';
const words = (s: string) => s.replaceAll('_', ' ');
export default function CommandCenter() {
  const { catalog, filters } = useAtlas();
  const { state, error } = useCommand();
  const agents = agentsFor(catalog, state);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<CommandAgent | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [project, setProject] = useState(filters.project);
  const agent = agents.find(a => a.id === selected);
  const tasks = state.tasks.filter(t => (!selected || t.agentId === selected) && (!project || t.projectId === project));
  function run(command: Command) { try { dispatch(command); setMessage(''); return true; } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to save changes.'); return false; } }
  const projectName = (id?: string) => catalog.projects.find(p => p.id === id)?.name ?? id ?? 'No project';
  const newAgent = () => setEditing({ id: crypto.randomUUID(), name: '', title: '', description: '', department: 'operations', status: 'idle', assignedProjects: [], capabilities: [], integrations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return <div className="command-center">
    <div className="cc-heading"><div><div className="eyebrow">AI Ops Atlas · Phase 1</div><h1>Agent Command Center</h1><p>Local configuration and simulation. Approvals never execute external actions.</p></div><button className="btn primary" onClick={newAgent}>Register agent</button></div>
    {(error || message) && <p role="alert" className="cc-notice">{error || message}</p>}
    <div className="cc-metrics">{[
      ['Registered agents', agents.length], ['Working · simulation', agents.filter(a => a.status === 'working').length],
      ['Pending tasks', state.tasks.filter(t => ['queued', 'in_progress'].includes(t.status)).length], ['Awaiting approval', state.approvals.filter(a => a.status === 'pending').length],
      ['Errors · last 7 days', state.events.filter(e => e.type === 'agent_error_recorded' && Date.parse(e.at) > Date.now() - 7 * 86400000).length],
    ].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    <label className="cc-filter">Project <select value={project} onChange={e => setProject(e.target.value)}><option value="">All projects</option>{catalog.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="cc-columns"><section><h2>Agent directory</h2><button className="text-btn" onClick={() => setSelected('')}>Show all tasks</button>
      <div className="cc-directory">{agents.filter(a => !project || a.assignedProjects.includes(project)).map(a => <button key={a.id} className={`cc-card ${selected === a.id ? 'selected' : ''}`} onClick={() => setSelected(a.id)}>
        <strong>{a.name}</strong><span>{a.title} · {a.department}</span><span className="chip">Simulation: {words(a.status)}</span><span>{a.assignedProjects.map(projectName).join(', ') || 'Unassigned'}</span><span>{a.capabilities.join(' · ') || 'Capabilities not configured'}</span><small>Last local activity: {state.events.find(e => e.agentId === a.id)?.at ? new Date(state.events.find(e => e.agentId === a.id)!.at).toLocaleString() : 'None recorded'}</small>
      </button>)}</div>
    </section><section>
      {agent && <div className="cc-box"><h2>{agent.name}</h2><p>{agent.description || 'Mission not documented.'}</p><p>Integrations declared: {agent.integrations.join(', ') || 'None'}</p><p>Operational status: {words(agent.status)} · simulation only</p><button className="btn" onClick={() => setEditing({ ...agent })}>Edit profile & assignments</button><p className="muted small">Existing runtime evidence remains in Atlas’s Agents workspace.</p></div>}
      <div className="cc-box"><h2>Create simulated task</h2><form className="cc-form" onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget); const now = new Date().toISOString();
        const t: AgentTask = { id: crypto.randomUUID(), agentId: String(f.get('agent')), projectId: String(f.get('project')) || undefined, title: String(f.get('title')).trim(), description: String(f.get('description')), priority: f.get('priority') as AgentTask['priority'], risk: f.get('risk') as AgentTask['risk'], status: 'queued', executionMode: 'simulation', createdAt: now, updatedAt: now };
        if (run({ type: 'task', task: t })) e.currentTarget.reset();
      }}>
        <label>Agent<select name="agent" required key={selected} defaultValue={selected}><option value="">Choose agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Project<select name="project" key={project} defaultValue={project}><option value="">No project</option>{catalog.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Title<input name="title" required maxLength={200}/></label><label>Description<textarea name="description" rows={2}/></label>
        <label>Priority<select name="priority" defaultValue="medium">{['low', 'medium', 'high'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Proposed risk<select name="risk" defaultValue="low">{['low', 'medium', 'high'].map(v => <option key={v}>{v}</option>)}</select></label><button className="btn primary">Create simulation</button>
      </form></div>
      <div className="cc-box"><h2>Task queue</h2><label>Status <select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{words(s)}</option>)}</select></label>
      {tasks.filter(t => !filter || t.status === filter).length === 0 && <p className="muted">No tasks in this view.</p>}
      {tasks.filter(t => !filter || t.status === filter).map(t => <details className="cc-task" key={t.id}><summary>{t.title} · {t.priority} · {t.status === 'completed' ? 'Simulated execution completed' : words(t.status)}</summary><p>{t.description || 'No description.'}</p><p>{agents.find(a => a.id === t.agentId)?.name ?? t.agentId} · {projectName(t.projectId)} · risk: {t.risk}</p><div className="cc-actions">{allowedStatuses(t.status).map(s => <button className="btn" key={s} onClick={() => run({ type: 'status', taskId: t.id, status: s })}>{s === 'completed' ? 'Complete simulation' : s === 'awaiting_approval' ? 'Request approval' : words(s)}</button>)}</div><h3>Task history</h3>{state.events.filter(e => e.taskId === t.id).map(e => <p key={e.id}><time>{new Date(e.at).toLocaleString()}</time> — {e.description}</p>)}</details>)}
      </div>
    </section></div>
    <section className="cc-box"><h2>Approval center</h2><p>Approval records authorize future consideration only. Simulation completion is recorded separately; actual execution is unavailable in Phase 1.</p>
      {state.approvals.length === 0 && <p className="muted">No approval requests.</p>}
      {state.approvals.filter(a => tasks.some(t => t.id === a.taskId)).map(a => { const t = state.tasks.find(t => t.id === a.taskId)!; return <div className="cc-task" key={a.id}><strong>{t.title}</strong><p>{agents.find(x => x.id === t.agentId)?.name} · {projectName(t.projectId)} · {t.risk} risk</p><p>{t.description}</p><p>{a.status === 'approved' ? 'Approved for future execution — no action executed' : a.status} · {new Date(a.decidedAt ?? a.requestedAt).toLocaleString()}</p>{a.status === 'pending' && <div className="cc-actions"><button className="btn" onClick={() => run({ type: 'decision', approvalId: a.id, approve: true })}>Approve locally</button><button className="btn" onClick={() => run({ type: 'decision', approvalId: a.id, approve: false })}>Reject</button></div>}</div>; })}
    </section>
    <section className="cc-box"><h2>Activity timeline</h2>{state.events.filter(e => (!selected || e.agentId === selected) && (!project || e.projectId === project || (!e.projectId && agents.find(a => a.id === e.agentId)?.assignedProjects.includes(project)))).slice(0, 100).map(e => <div className="cc-task" key={e.id}><time>{new Date(e.at).toLocaleString()}</time> · {words(e.type)}<p>{agents.find(a => a.id === e.agentId)?.name} · {projectName(e.projectId)} — {e.description}</p></div>)}{!state.events.length && <p className="muted">No local activity recorded.</p>}</section>
    {editing && <div className="cc-modal"><section role="dialog" aria-modal="true" aria-label="Agent configuration" className="cc-box"><h2>Agent configuration</h2><form className="cc-form" onSubmit={e => { e.preventDefault(); if (agents.some(a => a.id !== editing.id && a.name.trim().toLowerCase() === editing.name.trim().toLowerCase())) { setMessage('An equivalent agent name already exists. Edit its existing record.'); return; } if (run({ type: 'agent', agent: editing })) setEditing(null); }}>
      {!agents.some(a => a.id === editing.id) && <label>Configuration template<select defaultValue="" onChange={e => { const t = templates[Number(e.target.value)]; if (t) setEditing({ ...editing, ...t }); }}><option value="" disabled>Custom agent or select a template</option>{templates.map((t, i) => <option key={t.name} value={i}>{t.name} · template only</option>)}</select></label>}
      <label>Name<input required value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label><label>Role<input required value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })}/></label><label>Mission and responsibilities<textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}/></label>
      <label>Department<select value={editing.department} onChange={e => setEditing({ ...editing, department: e.target.value as CommandAgent['department'] })}>{departments.map(d => <option key={d}>{d}</option>)}</select></label>
      <label>Simulation status<select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as CommandAgent['status'] })}>{['idle', 'working', 'waiting_approval', 'error', 'offline'].map(s => <option key={s} value={s}>{words(s)}</option>)}</select></label>
      <label>Capabilities · comma separated<input value={editing.capabilities.join(',')} onChange={e => setEditing({ ...editing, capabilities: e.target.value.split(',') })}/></label><label>Integrations · declarations only<input value={editing.integrations.join(',')} onChange={e => setEditing({ ...editing, integrations: e.target.value.split(',') })}/></label>
      <fieldset><legend>Project assignments</legend>{catalog.projects.map(p => <label key={p.id}><input type="checkbox" checked={editing.assignedProjects.includes(p.id)} onChange={e => setEditing({ ...editing, assignedProjects: e.target.checked ? [...editing.assignedProjects, p.id] : editing.assignedProjects.filter(id => id !== p.id) })}/>{p.name}</label>)}</fieldset>
      {message && <p role="alert">{message}</p>}<div className="cc-actions"><button className="btn primary">Save configuration</button><button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form></section></div>}
  </div>;
}
