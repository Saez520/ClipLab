import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
let app:any;
afterEach(async()=>{if(app) await app.close();});
describe('synthesis acceptance', () => {
  it('supports continuity, result retrieval and NOTE handoff projection without FSM advancement', async () => {
    app = buildApp(':memory:');
    await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId: 's-1' } });
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/s-1/synthesis/sessions', payload: { sessionId: 'task-1', actor: 'director', recipient: 'DIRECTOR' } });
    expect(response.statusCode).toBe(201);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/s-1/synthesis/queries', payload: { sessionId: 'task-1', actor: 'director', recipient: 'DIRECTOR', query: 'context', context: [{ kind: 'CURRENT_SESSION', content: 'known' }] } });
    const query = response.json();
    expect(response.statusCode).toBe(201);
    response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/s-1/synthesis/queries/${query.queryId}/result`, payload: { sessionId: 'task-1', conclusion: 'partial', relevantEvidence: ['source evidence'], uncertainties: ['missing source'], recommendation: 'ask Director', partial: true, actionRequired: 'confirm source' } });
    expect(response.statusCode).toBe(200);
    response = await app.inject({ method: 'GET', url: `/api/v1/opportunities/s-1/synthesis/sessions/task-1/queries/${query.queryId}/handoff` });
    expect(response.json()).toMatchObject({ relevantSynthesis: 'partial\nask Director\nsource evidence', acceptedGaps: ['missing source', 'confirm source'] });
    response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/s-1/lineage' });
    expect(response.json().state).toBe('NOTE');
  });

  it('rejects a non-director recipient over HTTP', async () => {
    app = buildApp(':memory:');
    await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId: 's-writer' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/s-writer/synthesis/sessions', payload: { sessionId: 'task-writer', actor: 'writer', recipient: 'WRITER' } });
    expect(response.statusCode).toBe(400);
  });

  it('isolates a query from another session', async () => {
    app = buildApp(':memory:');
    await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId: 's-2' } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/s-2/synthesis/sessions/other/queries/nope' });
    expect(response.statusCode).toBe(404);
  });
});
