import { useAtlas } from '../../state';
import { agentsFor } from './model';
import { useCommand } from './store';
export function ProjectAgents({ projectId }: { projectId: string }) {
  const { catalog, setView, clearFilters, setFilters } = useAtlas();
  const { state } = useCommand();
  const agents = agentsFor(catalog, state).filter(a => a.assignedProjects.includes(projectId));
  const tasks = state.tasks.filter(t => t.projectId === projectId && !['completed', 'cancelled'].includes(t.status));
  return <section><div className="section-title">Command Center · simulation</div>
    {agents.length ? agents.map(a => <p key={a.id}>{a.name} <span className="chip">{a.status.replaceAll('_', ' ')} · local simulation</span></p>) : <p className="muted small">No assigned agents.</p>}
    <p>{tasks.length} outstanding simulated tasks</p>{tasks.map(t => <p key={t.id} className="small">{t.title} · {t.status.replaceAll('_', ' ')}</p>)}
    <button className="btn" onClick={() => { clearFilters(); setFilters({ project: projectId }); setView('command'); }}>Open Agent Command Center</button>
  </section>;
}
