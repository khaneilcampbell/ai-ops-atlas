import { describe, expect, it } from 'vitest';
import { agentsFor, emptyState, transition, type AgentTask, type CommandAgent } from './model';
import { readState } from './store';
const agent: CommandAgent = { id: 'a', name: 'Agent', title: 'Reviewer', description: '', department: 'engineering', status: 'idle', assignedProjects: ['p'], capabilities: [], integrations: [], createdAt: '2026-10-28', updatedAt: '2026-10-28' };
const task: AgentTask = { id: 't', agentId: 'a', projectId: 'p', title: 'Review', description: '', status: 'queued', priority: 'high', risk: 'low', executionMode: 'simulation', createdAt: '2026-10-28', updatedAt: '2026-10-28' };
const initial = () => transition(transition(emptyState(), { type: 'agent', agent }), { type: 'task', task });
describe('local command lifecycle', () => {
  it('records completion only as simulation and leaves input immutable', () => {
    const start = initial();
    const running = transition(start, { type: 'status', taskId: 't', status: 'in_progress' });
    const done = transition(running, { type: 'status', taskId: 't', status: 'completed' });
    expect(start.tasks[0].status).toBe('queued');
    expect(done.tasks[0].executionMode).toBe('simulation');
    expect(done.events[0].type).toBe('simulation_completed');
    expect(() => transition(done, { type: 'status', taskId: 't', status: 'in_progress' })).toThrow();
    expect(() => transition(start, { type: 'status', taskId: 't', status: 'completed' })).toThrow();
  });
  it('approval never completes or starts a task and cannot be replayed', () => {
    const pending = transition(initial(), { type: 'status', taskId: 't', status: 'awaiting_approval' }, undefined, 'approval');
    expect(() => transition(pending, { type: 'status', taskId: 't', status: 'completed' })).toThrow();
    const approved = transition(pending, { type: 'decision', approvalId: 'approval', approve: true });
    expect(approved.tasks[0].status).toBe('queued');
    expect(approved.events[0].description).toContain('no action executed');
    expect(() => transition(approved, { type: 'decision', approvalId: 'approval', approve: true })).toThrow();
    const rejected = transition(pending, { type: 'decision', approvalId: 'approval', approve: false });
    expect(rejected.tasks[0].status).toBe('cancelled');
  });
  it('cancelling a pending task closes the approval', () => {
    const pending = transition(initial(), { type: 'status', taskId: 't', status: 'awaiting_approval' }, undefined, 'approval');
    const cancelled = transition(pending, { type: 'status', taskId: 't', status: 'cancelled' });
    expect(cancelled.approvals[0].status).toBe('rejected');
    expect(() => transition(cancelled, { type: 'decision', approvalId: 'approval', approve: true })).toThrow();
  });
  it('round trips assignments, tasks, approvals and events', () => {
    const pending = transition(initial(), { type: 'status', taskId: 't', status: 'awaiting_approval' });
    expect(readState(JSON.stringify(pending))).toEqual(pending);
    expect(readState(null)).toEqual(emptyState());
    expect(() => readState('{bad')).toThrow();
    expect(() => readState(JSON.stringify({ ...pending, version: 2 }))).toThrow();
    expect(() => readState(JSON.stringify({ ...pending, tasks: [{ ...task, executionMode: 'real' }] }))).toThrow();
  });
  it('uses one identity for catalog agents and local overrides', () => {
    const catalog = { projects: [], agents: [{ id: 'a', name: 'Catalog agent', purpose: '', framework: '', status: 'idle' as const, projectId: 'old', repository: '', lastRun: null, history: [], links: [] }] };
    const merged = agentsFor(catalog, initial());
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'a', name: 'Agent', assignedProjects: ['p'] });
    expect(catalog.agents[0].projectId).toBe('old');
  });
});
