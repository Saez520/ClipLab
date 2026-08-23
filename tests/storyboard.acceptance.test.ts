import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { extractTechnicalConditions } from '../src/domain/technical-conditions.js';

let app: any;
afterEach(async () => { if (app) await app.close(); });

const segment = (id: string, position: number, dependsOn: string[] = []) => { const span = `span-${id}`; const narrativeStart = position * 8; return ({ segmentId: id, narrativeSpan: span, narrativeStart, narrativeEnd: narrativeStart + span.length, durationSeconds: 30, audio: `audio-${id}`, visualRepresentation: `visual-${id}`, audiovisualMapping: { narrativeMeaning: `meaning-${id}`, audio: `audio-${id}`, visual: `visual-${id}`, correspondence: `mapping-${id}` }, rhythm: 'steady', synchronization: 'sync', sourceReferences: [{ path: 'source.md', locator: '1', segmentId: id }], technicalCoverage: [], dependsOn }); };

async function prepare(opportunityId: string, source = 'span-s1 span-s2 audio-s1 audio-s2 visual-s1 visual-s2 meaning-s1 meaning-s2 revised visual') {
  await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId } });
  let response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/curation/proposals`, payload: { originalNote: 'note', evidence: 'evidence', centralApproach: 'approach', audience: 'BOTH', objective: 'DISCOVERY' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/curation/proposals/${response.json().proposal_id}/approve`, payload: { actor: 'user' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/advance`, payload: { actor: 'director', role: 'DIRECTOR', payload: { opportunityId, originalNote: 'note', directorDecision: 'APPROVE', centralApproach: 'approach' } } });
  response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/configurations`, payload: { director: 'director', audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/configurations/${response.json().configuration_id}/approve`, payload: { actor: 'user' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/scripts/generate`, payload: { narrativeText: 'span-s1 span-s2 [source.md:1]', sources: { 'source.md': source } } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/scripts/validate`, payload: { actor: 'director', role: 'DIRECTOR' } });
  response = await app.inject({ method: 'GET', url: `/api/v1/opportunities/${opportunityId}/narrative/handoff` });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/advance`, payload: { actor: 'writer', role: 'WRITER', payload: response.json() } });
}

describe('storyboard acceptance', () => {
  it('completes storyboard correction and authorized handoff without rendering', async () => {
    app = buildApp(':memory:');
    await prepare('story-1');
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/storyboard', payload: { actor: 'storyboard', segments: [segment('s1', 0), segment('s2', 1, ['s1'])] } });
    expect(response.statusCode).toBe(201);
    const firstRevision = response.json().storyboardRevisionId;
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/storyboard/approve', payload: { actor: 'user', storyboardRevisionId: firstRevision } });
    expect(response.statusCode).toBe(200);
    response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-1/storyboard/handoff' });
    expect(response.statusCode).toBe(409);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/storyboard/corrections', payload: { actor: 'user', segmentId: 's1', expectedAdjustment: 'revised visual' } });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    const correctedRevision = response.json().revision.storyboardRevisionId;
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/storyboard/approve', payload: { actor: 'user', storyboardRevisionId: correctedRevision } });
    expect(response.statusCode).toBe(409);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/storyboard/revalidate', payload: { actor: 'storyboard' } });
    expect(response.statusCode).toBe(200);
    const revalidatedRevision = response.json().storyboardRevisionId;
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/storyboard/approve', payload: { actor: 'user', storyboardRevisionId: revalidatedRevision } });
    expect(response.statusCode).toBe(200);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/authorize', payload: { actor: 'storyboard', role: 'STORYBOARD' } });
    expect(response.statusCode).toBe(200);
    response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-1/storyboard/handoff' });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe('AUTHORIZED_FOR_PRODUCTION');
    const firstHandoff = response.json();
    response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-1/storyboard/handoff' });
    expect(response.json()).toEqual(firstHandoff);
    expect(firstHandoff.sources[0].path).toBe('source.md');
    expect(firstHandoff.sources[0].content).toContain('visual-s1');
    expect(firstHandoff.validations.every((validation: any) => validation.introducesUnsupportedClaims === false)).toBe(true);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/advance', payload: { actor: 'storyboard', role: 'STORYBOARD', payload: response.json() } });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe('RENDER');
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-1/advance', payload: { actor: 'storyboard', role: 'STORYBOARD', payload: firstHandoff } });
    expect(response.statusCode).toBe(409);
    const lineage = await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-1/storyboard/lineage' });
    expect(lineage.statusCode).toBe(200);
    expect(lineage.json().revisions).toHaveLength(3);
  });

  it('blocks audio-only representations and does not persist a partial revision', async () => {
    app = buildApp(':memory:');
    await prepare('story-2');
    const response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-2/storyboard', payload: { segments: [{ ...segment('s1', 0), visualRepresentation: 'audio-s1' }] } });
    expect(response.statusCode).toBe(409);
    const current = await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-2/storyboard' });
    expect(current.statusCode).toBe(404);
  });

  it('blocks an unvalidated script before accepting any storyboard payload', async () => {
    app = buildApp(':memory:');
    await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId: 'story-unvalidated' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-unvalidated/storyboard', payload: { segments: [segment('s1', 0)] } });
    expect(response.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-unvalidated/storyboard' })).statusCode).toBe(404);
  });

  it('resolves sources server-side and rejects forged content or segment ownership', async () => {
    app = buildApp(':memory:');
    await prepare('story-source');
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-source/storyboard', payload: { segments: [{ ...segment('s1', 0), sourceReferences: [{ path: 'source.md', locator: '1', summary: 'forged summary', segmentId: 's1' }] }] } });
    expect(response.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-source/storyboard' })).statusCode).toBe(404);

    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-source/storyboard', payload: { segments: [{ ...segment('s1', 0), sourceReferences: [{ path: 'source.md', locator: '1', segmentId: 's2' }] }] } });
    expect(response.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-source/storyboard' })).statusCode).toBe(404);
  });

  it('detects narrative omission and unsupported visual claims server-side', async () => {
    app = buildApp(':memory:');
    await prepare('story-material');
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-material/storyboard', payload: { segments: [{ ...segment('s1', 0), narrativeSpan: 'omitted narrative span' }] } });
    expect(response.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-material/storyboard' })).statusCode).toBe(404);

    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-material/storyboard', payload: { segments: [{ ...segment('s1', 0), visualRepresentation: 'unsupported claim', audiovisualMapping: { ...segment('s1', 0).audiovisualMapping, visual: 'unsupported claim' } }] } });
    expect(response.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-material/storyboard' })).statusCode).toBe(404);
  });

  it('does not allow revalidate to bypass the Director after an editorial correction', async () => {
    app = buildApp(':memory:');
    await prepare('story-editorial');
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-editorial/storyboard', payload: { segments: [segment('s1', 0)] } });
    expect(response.statusCode).toBe(201);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-editorial/storyboard/corrections', payload: { actor: 'user', segmentId: 's1', expectedAdjustment: 'change editorial wording', editorialChange: true } });
    expect(response.statusCode).toBe(201);
    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-editorial/storyboard/revalidate', payload: { actor: 'storyboard' } });
    expect(response.statusCode).toBe(409);
    const current = await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-editorial/storyboard' });
    expect(current.json().state).toBe('STORYBOARD_BLOCKED');
    expect(current.json().storyboardRevisionId).toContain('revision-2');
  });

  it('blocks unsupported corrections visibly and allows a valid correction retry', async () => {
    app = buildApp(':memory:');
    await prepare('story-retry');
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-retry/storyboard', payload: { segments: [segment('s1', 0)] } });
    expect(response.statusCode).toBe(201);

    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-retry/storyboard/corrections', payload: { actor: 'user', segmentId: 's1', expectedAdjustment: 'aerial drone shot over the city' } });
    expect(response.statusCode).toBe(201);

    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-retry/storyboard/revalidate', payload: { actor: 'storyboard' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('Unsupported claims');

    response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-retry/storyboard' });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe('STORYBOARD_BLOCKED');
    expect(response.json().blockedReason).toContain('Unsupported claims');

    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-retry/storyboard/corrections', payload: { actor: 'user', segmentId: 's1', expectedAdjustment: 'revised visual' } });
    expect(response.statusCode).toBe(201);
    expect(response.json().revision.state).toBe('STORYBOARD_CORRECTION_REQUESTED');

    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-retry/storyboard/revalidate', payload: { actor: 'storyboard' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe('STORYBOARD_READY_FOR_USER_APPROVAL');
  });

  it('blocks omission of a persisted technical condition and leaves no partial revision', async () => {
    app = buildApp(':memory:');
    await prepare('story-technical-omission', '1080p');
    const response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-technical-omission/storyboard', payload: { segments: [segment('s1', 0)] } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('condition');
    expect(response.json().error.details.segmentId).toBe('s1');
    expect(response.json().error.details.evidence.path).toBe('source.md');
    expect((await app.inject({ method: 'GET', url: '/api/v1/opportunities/story-technical-omission/storyboard' })).statusCode).toBe(404);
  });

  it('materializes exact canonical technical coverage and rejects value substitution under a reused ID', async () => {
    app = buildApp(':memory:');
    await prepare('story-technical-success', '1080p');
    const condition = extractTechnicalConditions({ path: 'source.md', locator: '1', content: '1080p' }).conditions[0];
    const covered = { ...segment('s1', 0), technicalCoverage: [{ conditionId: condition.conditionId, applicationMode: 'overlay' }] };
    let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-technical-success/storyboard', payload: { segments: [covered] } });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json().segments[0].technicalConditions[0].canonicalValue).toEqual({ value: 1080, unit: 'p' });
    expect(response.json().segments[0].technicalCoverage[0].condition.canonicalValue).toEqual({ value: 1080, unit: 'p' });

    response = await app.inject({ method: 'POST', url: '/api/v1/opportunities/story-technical-success/storyboard', payload: { segments: [{ ...covered, visualRepresentation: '720p', audiovisualMapping: { ...covered.audiovisualMapping, visual: '720p' } }] } });
    expect(response.statusCode).toBe(409);
  });
});
