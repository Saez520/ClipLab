import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';

let app: any;
afterEach(async () => { if (app) await app.close(); });

describe('narrative acceptance', () => {
  it('requires user and Director approval before SCRIPT to STORYBOARD', async () => {
    app = buildApp(':memory:');
    await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId: 'n1' } });
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/curation/proposals', payload: { originalNote: 'n', evidence: 'e', centralApproach: 'a', audience: 'BOTH', objective: 'DISCOVERY' } });
    const proposalId = response.json().proposal_id;
    await app.inject({ method: 'POST', url: `/api/v1/opportunities/n1/curation/proposals/${proposalId}/approve`, payload: { actor: 'user' } });
    await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/advance', payload: { actor: 'director', role: 'DIRECTOR', payload: { opportunityId: 'n1', originalNote: 'n', directorDecision: 'APPROVE', centralApproach: 'a' } } });
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/narrative/configurations', payload: { director: 'director', audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous', targetDurationSeconds: 30 } });
    expect(response.statusCode).toBe(201);
    const configurationId = response.json().configuration_id;
    response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/n1/narrative/configurations/${configurationId}/approve`, payload: { actor: 'user' } });
    expect(response.statusCode).toBe(200);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/narrative/scripts/generate', payload: { narrativeText: 'Texto continuo [src/example.ts:1]', sources: { 'src/example.ts': 'line' } } });
    expect(response.statusCode).toBe(201);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/authorize', payload: { actor: 'writer', role: 'WRITER' } });
    expect(response.statusCode).toBe(409);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/advance', payload: {
      actor: 'writer',
      role: 'WRITER',
      payload: {
        opportunityId: 'n1', scriptId: 'forged', authorizedScript: 'forged', references: [],
        configuration: { audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous', userApproved: true },
        validationStatus: 'DIRECTOR_VALIDATED', directorValidationId: 'forged', scriptAuthorization: 'forged'
      }
    } });
    expect(response.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/opportunities/n1/lineage' })).json().state).toBe('SCRIPT');
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/narrative/scripts/validate', payload: { actor: 'director', role: 'DIRECTOR' } });
    expect(response.statusCode).toBe(200);
    response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/n1/narrative/handoff' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('conceptsOnScreen');
    expect(response.json()).not.toHaveProperty('preciseConcepts');
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n1/advance', payload: { actor: 'writer', role: 'WRITER', payload: response.json() } });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe('STORYBOARD');
  });

  it('rejects premature generation and invalid references', async () => {
    app = buildApp(':memory:');
    await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId: 'n2' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/n2/narrative/scripts/generate', payload: { narrativeText: 'No autorizado' } });
    expect(response.statusCode).toBe(409);
  });
});
