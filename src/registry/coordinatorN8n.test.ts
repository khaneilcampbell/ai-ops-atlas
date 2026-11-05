import { expect, it } from 'vitest';
import { catalog } from '../catalog';
import { toProfile } from './profile';
import { agentJobs } from '../catalog/agentJobs';

it('links the existing Coordinator without replacing its fixture source or expanding permissions', () => {
  const agent = catalog.agents.find(a => a.id === 'atlas-production-coordinator')!;
  const p = toProfile(agent, catalog.projects.find(project => project.id === agent.projectId));
  expect(p.docs.technical).toBe('https://khancam15.app.n8n.cloud/projects/qhAhqRqO8TimFtxs/agents/xwPwuboturejm9hz');
  expect(agent.observe?.githubWorkflow).toBe('benjaire-production.yml');
  expect(agent.permissions).toEqual(['Read supplied evidence','Produce a review report']);
  expect(p.execution.triggerType).toBe('manual');
  expect(p.responsibilities.limitations.join(' ')).toContain('absent from the published snapshot');
  expect(p.cost.budget).toContain('absent from the inspected published snapshot');
  expect(agentJobs(catalog).find(job => job.agentId === agent.id)?.work.label).toContain('floor 3');
});
