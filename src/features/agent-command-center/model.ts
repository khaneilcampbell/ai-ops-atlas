import type { Catalog } from '../../catalog/types';
export const departments = ['engineering', 'security', 'infrastructure', 'business', 'research', 'operations'] as const;
export type Department = typeof departments[number];
export type AgentStatus = 'idle' | 'working' | 'waiting_approval' | 'error' | 'offline';
export interface CommandAgent {
  id: string; name: string; title: string; description: string; department: Department;
  status: AgentStatus; assignedProjects: string[]; capabilities: string[]; integrations: string[];
  createdAt: string; updatedAt: string;
}
export const statuses = ['queued', 'in_progress', 'awaiting_approval', 'completed', 'failed', 'cancelled'] as const;
export type TaskStatus = typeof statuses[number];
export interface AgentTask {
  id: string; agentId: string; projectId?: string; title: string; description: string;
  status: TaskStatus; priority: 'low' | 'medium' | 'high'; executionMode: 'simulation';
  risk: 'low' | 'medium' | 'high'; createdAt: string; updatedAt: string;
}
export interface Approval { id: string; taskId: string; status: 'pending' | 'approved' | 'rejected'; requestedAt: string; decidedAt?: string }
export interface CommandEvent { id: string; at: string; type: string; agentId: string; taskId?: string; projectId?: string; description: string }
export interface CommandState { version: 1; agents: CommandAgent[]; tasks: AgentTask[]; approvals: Approval[]; events: CommandEvent[] }
export const emptyState = (): CommandState => ({ version: 1, agents: [], tasks: [], approvals: [], events: [] });
export const templates: Pick<CommandAgent, 'name' | 'title' | 'description' | 'department' | 'capabilities'>[] = [
  { name: 'Infrastructure Agent', title: 'Infrastructure monitoring', department: 'infrastructure', description: 'Review domains, server health and deployment visibility.', capabilities: ['Domain status', 'Server health', 'Deployment visibility'] },
  { name: 'Development Agent', title: 'Development analyst', department: 'engineering', description: 'Review repositories, code quality, documentation and dependencies.', capabilities: ['Repository analysis', 'Code quality', 'Dependency monitoring'] },
  { name: 'Security Agent', title: 'Security reviewer', department: 'security', description: 'Assess alerts, vulnerable dependencies and configuration.', capabilities: ['Alert review', 'Vulnerability analysis', 'Configuration assessment'] },
  { name: 'Business Operations Agent', title: 'Business analyst', department: 'business', description: 'Prepare intelligence, product research and operational reporting.', capabilities: ['Business intelligence', 'Product research', 'Reporting'] },
  { name: 'Research Agent', title: 'Research analyst', department: 'research', description: 'Research markets, technology and competitors.', capabilities: ['Market research', 'Technology research', 'Competitive intelligence'] },
  { name: 'Documentation Agent', title: 'Documentation specialist', department: 'operations', description: 'Review project documentation, architecture and development history.', capabilities: ['Documentation', 'Architecture summaries', 'Development history'] },
];
/** Catalog identities remain authoritative. Only local configuration overrides are persisted. */
export function agentsFor(catalog: Catalog, state: CommandState): CommandAgent[] {
  const agents = catalog.agents.map((a): CommandAgent => ({
    id: a.id, name: a.name, title: a.registry?.title ?? a.name, description: a.purpose,
    department: departments.includes(a.registry?.category as Department) ? a.registry!.category as Department : 'operations',
    status: 'idle', assignedProjects: [a.projectId], capabilities: a.capabilities ?? a.registry?.responsibilities?.tasks ?? [],
    integrations: a.registry?.responsibilities?.tools ?? [], createdAt: '', updatedAt: '',
  }));
  const merged = new Map(agents.map(a => [a.id, a]));
  state.agents.forEach(a => merged.set(a.id, a));
  return [...merged.values()];
}
export type Command = { type: 'agent'; agent: CommandAgent } | { type: 'task'; task: AgentTask } | { type: 'status'; taskId: string; status: TaskStatus } | { type: 'decision'; approvalId: string; approve: boolean };
const nextStatuses: Record<TaskStatus, TaskStatus[]> = {
  queued: ['in_progress', 'awaiting_approval', 'cancelled'], in_progress: ['awaiting_approval', 'completed', 'failed', 'cancelled'],
  awaiting_approval: ['cancelled'], completed: [], failed: ['queued', 'cancelled'], cancelled: [],
};
export function transition(state: CommandState, command: Command, at = new Date().toISOString(), id = crypto.randomUUID()): CommandState {
  const next = structuredClone(state);
  const event = (type: string, agentId: string, description: string, task?: AgentTask) => next.events.unshift({ id, at, type, agentId, description, taskId: task?.id, projectId: task?.projectId });
  if (command.type === 'agent') {
    const a = command.agent;
    if (!a.name.trim() || !a.title.trim() || next.agents.some(x => x.id !== a.id && x.name.trim().toLowerCase() === a.name.trim().toLowerCase())) throw new Error('Use a unique agent name and provide a role.');
    const exists = next.agents.some(x => x.id === a.id);
    next.agents = [...next.agents.filter(x => x.id !== a.id), { ...a, updatedAt: at }];
    event(exists ? 'agent_updated' : 'agent_registered', a.id, `${a.name}: local configuration saved.`);
  } else if (command.type === 'task') {
    const t = command.task;
    if (!t.title.trim() || !t.agentId || t.executionMode !== 'simulation' || t.status !== 'queued' || next.tasks.some(x => x.id === t.id)) throw new Error('A new simulation needs a title, agent and unique identity.');
    next.tasks.unshift(t);
    event('task_created', t.agentId, `Simulation queued and assigned: ${t.title}`, t);
  } else if (command.type === 'status') {
    const t = next.tasks.find(t => t.id === command.taskId);
    if (!t || !nextStatuses[t.status].includes(command.status)) throw new Error('This task status transition is unavailable.');
    t.status = command.status; t.updatedAt = at;
    if (t.status === 'awaiting_approval') next.approvals.unshift({ id, taskId: t.id, status: 'pending', requestedAt: at });
    if (t.status === 'cancelled') next.approvals.filter(a => a.taskId === t.id && a.status === 'pending').forEach(a => { a.status = 'rejected'; a.decidedAt = at; });
    event(t.status === 'completed' ? 'simulation_completed' : t.status === 'awaiting_approval' ? 'approval_requested' : t.status === 'failed' ? 'agent_error_recorded' : 'task_status_changed', t.agentId, `${t.title}: simulation ${t.status.replaceAll('_', ' ')}.`, t);
  } else {
    const a = next.approvals.find(a => a.id === command.approvalId);
    const t = next.tasks.find(t => t.id === a?.taskId);
    if (!a || a.status !== 'pending' || !t || t.status !== 'awaiting_approval') throw new Error('Approval is no longer pending.');
    a.status = command.approve ? 'approved' : 'rejected'; a.decidedAt = at;
    t.status = command.approve ? 'queued' : 'cancelled'; t.updatedAt = at;
    event(command.approve ? 'approval_granted' : 'approval_rejected', t.agentId, `${t.title}: ${command.approve ? 'approved for future execution; no action executed' : 'rejected'}.`, t);
  }
  return next;
}
export const allowedStatuses = (status: TaskStatus) => nextStatuses[status];
/** Read-only contract for a future independent runtime. Phase 1 provides no execution adapter. */
export interface AgentRuntimeAdapter {
  provider: 'claude' | 'openai' | 'n8n' | 'crewai' | 'github' | 'cloudflare' | 'mcp';
  getStatus(agentId: string): Promise<string>;
  getCapabilities(agentId: string): Promise<string[]>;
  getTaskHistory(agentId: string): Promise<AgentTask[]>;
}
