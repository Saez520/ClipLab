import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';

const FIXTURES = resolve(__dirname, 'fixtures/composition-templates');
import { RenderEnvironmentError, RenderSpecificationError, RenderUnclassifiedError } from '../src/domain/errors.js';
import type { RenderCliRequest, RenderCliResult, VideoRenderer, VoiceSynthesizer } from '../src/domain/render.js';

/*
 * CA criteria coverage map (ca-produccion-video-sincronizado):
 * - CA-1 (vigente → narración/visuales sincronizados con el paquete): 'produces the final synchronized video'
 * - CA-2 (obsoleto/corrección pendiente → gate rechaza sin renderizar): 'stale package does not render'
 * - CA-3 (ENVIRONMENT → segmento/causa/sugerencia + retry registrado): 'environment failure shows diagnosis'
 * - CA-4 (SPECIFICATION → vuelve a storyboard con nueva aprobación, sin auto-retry): 'specification failure returns to storyboard'
 * - CA-5 (UNCLASSIFIED → crudo con ambas rutas): 'unclassified failure reaches the operator raw'
 * - CA-6 (incompleto nunca final): 'a failed render is never presented as final output'
 * - CA-7 (asociable a oportunidad/storyboard/revisión): 'result stays associated with its origin'
 * - CA-8 (>90s honrado exactamente): 'honors an approved duration beyond 90 seconds exactly'
 * - CA-9 (serial FIFO visible + MP4 conforme a defaults): 'runs queued productions one at a time in visible order'
 */

let app: any;

afterEach(async () => { if (app) { await app.close(); app = undefined as any; } });

const segment = (id: string, position: number, durationSeconds = 30, dependsOn: string[] = []) => {
  const span = `span-${id}`;
  const narrativeStart = position * 8;
  return {
    segmentId: id,
    narrativeSpan: span,
    narrativeStart,
    narrativeEnd: narrativeStart + span.length,
    durationSeconds,
    audio: `audio-${id}`,
    visualRepresentation: `visual-${id}`,
    audiovisualMapping: { narrativeMeaning: `meaning-${id}`, audio: `audio-${id}`, visual: `visual-${id}`, correspondence: `mapping-${id}` },
    rhythm: 'steady',
    synchronization: 'sync',
    sourceReferences: [{ path: 'source.md', locator: '1', segmentId: id }],
    technicalCoverage: [],
    dependsOn
  };
};

const SOURCE = 'span-s1 span-s2 audio-s1 audio-s2 visual-s1 visual-s2 meaning-s1 meaning-s2 revised visual';

async function prepareToStoryboard(opportunityId: string): Promise<void> {
  let response = await app.inject({ method: 'POST', url: '/api/v1/opportunities', payload: { opportunityId } });
  response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/curation/proposals`, payload: { originalNote: 'note', evidence: 'evidence', centralApproach: 'approach', audience: 'BOTH', objective: 'DISCOVERY' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/curation/proposals/${response.json().proposal_id}/approve`, payload: { actor: 'user' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/advance`, payload: { actor: 'director', role: 'DIRECTOR', payload: { opportunityId, originalNote: 'note', directorDecision: 'APPROVE', centralApproach: 'approach' } } });
  response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/configurations`, payload: { director: 'director', audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/configurations/${response.json().configuration_id}/approve`, payload: { actor: 'user' } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/scripts/generate`, payload: { narrativeText: 'span-s1 span-s2 [source.md:1]', sources: { 'source.md': SOURCE } } });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/narrative/scripts/validate`, payload: { actor: 'director', role: 'DIRECTOR' } });
  response = await app.inject({ method: 'GET', url: `/api/v1/opportunities/${opportunityId}/narrative/handoff` });
  await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/advance`, payload: { actor: 'writer', role: 'WRITER', payload: response.json() } });
}

async function reachRenderState(opportunityId: string, segments: ReturnType<typeof segment>[] = [segment('s1', 0), segment('s2', 1)], profile?: Record<string, unknown>): Promise<void> {
  await prepareToStoryboard(opportunityId);
  const storyboardPayload: Record<string, unknown> = { actor: 'storyboard', segments };
  if (profile) storyboardPayload.profile = profile;
  let response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/storyboard`, payload: storyboardPayload });
  expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
  const revisionId = response.json().storyboardRevisionId;
  response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/storyboard/approve`, payload: { actor: 'user', storyboardRevisionId: revisionId } });
  expect(response.statusCode).toBe(200);
  response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/authorize`, payload: { actor: 'storyboard', role: 'STORYBOARD' } });
  expect(response.statusCode).toBe(200);
  response = await app.inject({ method: 'GET', url: `/api/v1/opportunities/${opportunityId}/storyboard/handoff` });
  expect(response.statusCode).toBe(200);
  response = await app.inject({ method: 'POST', url: `/api/v1/opportunities/${opportunityId}/advance`, payload: { actor: 'storyboard', role: 'STORYBOARD', payload: response.json() } });
  expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
  expect(response.json().state).toBe('RENDER');
}

class FakeProductionRenderer implements VideoRenderer {
  behavior: 'success' | 'environmentCheck' | 'specificationLint' | 'unclassifiedRender' = 'success';
  renderDurationSeconds = 60;
  capturedRequests: RenderCliRequest[] = [];
  manifests: any[] = [];
  htmlDocuments: string[] = [];
  renderRanges: Array<{ start: number; end: number }> = [];
  narrationFilesSeen = new Set<string>();
  private environmentThrown = false;

  async preflight(): Promise<void> {}

  async lint(_compositionDir: string): Promise<void> {
    if (this.behavior === 'specificationLint') {
      throw new RenderSpecificationError('The composition fails engine validation (lint)', { validatorFindings: 'segment s1 references missing asset narration/s9.wav' });
    }
  }

  async check(_compositionDir: string): Promise<void> {
    if (this.behavior === 'environmentCheck' && !this.environmentThrown) {
      this.environmentThrown = true;
      throw new RenderEnvironmentError('Engine resources are unavailable', { suggestedAction: 'Free machine resources and retry from the operator endpoint' });
    }
  }

  async render(request: RenderCliRequest): Promise<RenderCliResult> {
    const start = performance.now();
    await new Promise(resolve => setTimeout(resolve, 25));
    if (this.behavior === 'unclassifiedRender') {
      this.renderRanges.push({ start, end: performance.now() });
      throw new RenderUnclassifiedError('The engine crashed with an unrecognized error', { rawLog: 'panic: runtime error: index out of range [3] with length 2', suggestedActions: ['retry after verifying the environment', 'return to storyboard with correction and reapproval'] });
    }
    const compositionHtml = readFileSync(join(request.compositionDir, 'index.html'), 'utf8');
    this.htmlDocuments.push(compositionHtml);
    this.manifests.push(JSON.parse(readFileSync(join(request.compositionDir, 'manifest.json'), 'utf8')));
    const manifestSegments: any[] = this.manifests[this.manifests.length - 1].segments ?? [];
    for (const item of manifestSegments) this.narrationFilesSeen.add(item.narrationFile);
    writeFileSync(request.outputPath, Buffer.from(`${request.compositionDir} mp4 bytes`));
    this.capturedRequests.push(request);
    this.renderRanges.push({ start, end: performance.now() });
    return { outputPath: request.outputPath, durationSeconds: this.renderDurationSeconds };
  }
}

class FakeNarrationSynthesizer implements VoiceSynthesizer {
  synthesizedTexts: Array<{ text: string; targetDurationSeconds: number }> = [];
  async preflight(): Promise<void> {}
  async synthesize(text: string, targetDurationSeconds: number, outputDir?: string): Promise<{ filePath: string; durationSeconds: number }> {
    this.synthesizedTexts.push({ text, targetDurationSeconds });
    const filePath = join(outputDir ?? '/tmp', `narration-${Math.abs(text.length)}.wav`);
    writeFileSync(filePath, Buffer.from('wav'));
    return { filePath, durationSeconds: Math.min(targetDurationSeconds, text.length / 10) };
  }
}

function productionFakes(): { renderer: FakeProductionRenderer; synthesizer: FakeNarrationSynthesizer } {
  return { renderer: new FakeProductionRenderer(), synthesizer: new FakeNarrationSynthesizer() };
}

async function waitForRenderState(renderId: string, state: string, timeoutMs = 5000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/renders/${renderId}` });
    const body = response.json();
    if (body.state === state) return body;
    if (Date.now() > deadline) throw new Error(`Timeout waiting for ${state}: ${JSON.stringify(body).slice(0, 400)}`);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

describe('production acceptance (CA ca-produccion-video-sincronizado)', () => {
  it('produces the final synchronized video whose narration and visuals match the approved package (CA-1)', async () => {
    const { renderer, synthesizer } = productionFakes();
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca1');

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca1/production', payload: { actor: 'operator' } });
    expect(started.statusCode, JSON.stringify(started.json())).toBe(202);
    const entry = started.json();
    expect(entry.state).toBe('QUEUED');
    expect(entry.renderId).toBe('prod-ca1-render-1');

    const queue = await app.inject({ method: 'GET', url: '/api/v1/renders' });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().map((row: any) => row.renderId)).toEqual(['prod-ca1-render-1']);

    const detail = await waitForRenderState(entry.renderId, 'SUCCEEDED');
    expect(detail.output.outputPath).toContain(join('renders', entry.renderId, 'output.mp4'));
    // Narration synthesized from the approved narrative spans of the package.
    expect(synthesizer.synthesizedTexts.map(item => item.text)).toEqual(['span-s1', 'span-s2']);
    expect(synthesizer.synthesizedTexts.every(item => item.targetDurationSeconds === 30)).toBe(true);
    // Visual clips composed from the template (meta-bar + badge + blocks); no plain <p class="visual">.
    expect(renderer.htmlDocuments[0]).toContain('class="meta-bar"');
    expect(renderer.htmlDocuments[0]).toContain('class="badge badge--cyan"');
    expect(renderer.htmlDocuments[0]).not.toContain('<p class="visual">');
    expect(renderer.htmlDocuments[0]).toContain('data-duration="30"');
    // Manifest registers template identity, version 1.1.0 and builder version 3.
    expect(renderer.manifests[0].template.name).toBe('pulso');
    expect(renderer.manifests[0].template.version).toBe('1.1.0');
    expect(renderer.manifests[0].template.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(renderer.manifests[0].builder.version).toBe(3);
    // Composition slots accumulate exactly like the approved rhythm.
    expect(renderer.manifests[0].segments.map((item: any) => item.startSeconds)).toEqual([0, 30]);
    // Staged execution in contract order.
    expect(renderer.narrationFilesSeen.size).toBeGreaterThan(0);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]).toMatchObject({ attemptNumber: 1, actor: 'operator', outcome: 'SUCCEEDED' });
  });

  it('stale package does not render and leaves the state visible (CA-2)', async () => {
    const { renderer, synthesizer } = productionFakes();
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca2');
    // A correction AFTER the authorization makes the persisted package stale.
    const correction = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca2/storyboard/corrections', payload: { actor: 'user', segmentId: 's1', expectedAdjustment: 'revised visual' } });
    expect(correction.statusCode).toBe(201);

    const rejected = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca2/production', payload: { actor: 'operator' } });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('PRODUCTION_GATE_FAILED');
    expect(rejected.json().error.details.reason).toBe('STALE_PACKAGE');

    const queue = await app.inject({ method: 'GET', url: '/api/v1/renders' });
    expect(queue.json()).toEqual([]); // nothing was enqueued
    const lineage = await app.inject({ method: 'GET', url: '/api/v1/opportunities/prod-ca2/lineage' });
    expect(lineage.json().state).toBe('RENDER'); // state remains visible and unchanged
    expect(renderer.capturedRequests).toHaveLength(0);
    expect(synthesizer.synthesizedTexts).toHaveLength(0);
  });

  it('environment failure shows segment/stage/cause/action and every operator retry is registered (CA-3)', async () => {
    const { renderer, synthesizer } = productionFakes();
    renderer.behavior = 'environmentCheck';
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca3');

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca3/production', payload: { actor: 'operator-a' } });
    expect(started.statusCode).toBe(202);
    const failed = await waitForRenderState(started.json().renderId, 'FAILED');
    expect(failed.failureClass).toBe('ENVIRONMENT');
    expect(failed.failureStage).toBe('VALIDATION');
    expect(failed.failureCause).toContain('resources are unavailable');
    expect(failed.failureSuggestedAction).toContain('retry');

    const retried = await app.inject({ method: 'POST', url: `/api/v1/renders/${started.json().renderId}/retry`, payload: { actor: 'operator-b' } });
    expect(retried.statusCode, JSON.stringify(retried.json())).toBe(202);
    const succeeded = await waitForRenderState(started.json().renderId, 'SUCCEEDED');
    expect(succeeded.attempts.map((attempt: any) => [attempt.attemptNumber, attempt.actor, attempt.outcome])).toEqual([
      [1, 'operator-a', 'FAILED'],
      [2, 'operator-b', 'SUCCEEDED']
    ]);
  });

  it('specification failure returns to storyboard, forbids retry, and never auto-retries (CA-4)', async () => {
    const { renderer, synthesizer } = productionFakes();
    renderer.behavior = 'specificationLint';
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca4');

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca4/production', payload: { actor: 'operator' } });
    expect(started.statusCode).toBe(202);
    const failed = await waitForRenderState(started.json().renderId, 'FAILED');
    expect(failed.failureClass).toBe('SPECIFICATION');
    expect(failed.failureCause).toMatch(/fails engine validation/);

    // The retry endpoint explains the path back to the storyboard.
    const forbidden = await app.inject({ method: 'POST', url: `/api/v1/renders/${started.json().renderId}/retry`, payload: { actor: 'operator' } });
    expect(forbidden.statusCode).toBe(409);
    expect(forbidden.json().error.message).toMatch(/storyboard/i);
    expect(forbidden.json().error.code).toBe('RENDER_SPECIFICATION');

    // No automatic retries happened: exactly one attempt exists.
    expect(failed.attempts).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 80));
    const stillFailed = await app.inject({ method: 'GET', url: `/api/v1/renders/${started.json().renderId}` });
    expect(stillFailed.json().state).toBe('FAILED');
    expect(stillFailed.json().attempts).toHaveLength(1);
  });

  it('unclassified failure reaches the operator raw with both paths visible (CA-5)', async () => {
    const { renderer, synthesizer } = productionFakes();
    renderer.behavior = 'unclassifiedRender';
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca5');

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca5/production', payload: { actor: 'operator' } });
    expect(started.statusCode).toBe(202);
    const failed = await waitForRenderState(started.json().renderId, 'FAILED');
    expect(failed.failureClass).toBe('UNCLASSIFIED');
    expect(failed.failureSuggestedAction).toMatch(/retry/i);
    expect(failed.failureSuggestedAction).toMatch(/storyboard/i);
    expect(failed.attempts[0].logExcerpt ?? '').toContain('index out of range');
    // The operator may still choose either path: retry is allowed here.
    renderer.behavior = 'success';
    const retried = await app.inject({ method: 'POST', url: `/api/v1/renders/${started.json().renderId}/retry`, payload: { actor: 'operator' } });
    expect(retried.statusCode).toBe(202);
    await waitForRenderState(started.json().renderId, 'SUCCEEDED');
  });

  it('a failed render is never presented as final output (CA-6)', async () => {
    const { renderer, synthesizer } = productionFakes();
    renderer.behavior = 'environmentCheck';
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca6');
    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca6/production', payload: { actor: 'operator' } });
    const failed = await waitForRenderState(started.json().renderId, 'FAILED');
    expect(failed.output).toBeNull();
    expect(failed.outputPath).toBeUndefined();
    expect(failed.outputSha256).toBeUndefined();

    // After success the output IS exposed.
    await app.inject({ method: 'POST', url: `/api/v1/renders/${started.json().renderId}/retry`, payload: { actor: 'operator' } });
    const succeeded = await waitForRenderState(started.json().renderId, 'SUCCEEDED');
    expect(succeeded.output.outputPath).toBeTruthy();
    expect(succeeded.output.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('result stays associated with its opportunity, storyboard and revision (CA-7)', async () => {
    const { renderer, synthesizer } = productionFakes();
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca7');
    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca7/production', payload: { actor: 'operator' } });
    const entry = started.json();
    await waitForRenderState(entry.renderId, 'SUCCEEDED');

    expect(entry.opportunityId).toBe('prod-ca7');
    expect(entry.storyboardId).toBe('prod-ca7-storyboard');
    expect(entry.storyboardRevisionId).toBe('prod-ca7-storyboard-revision-1');
    expect(entry.userApprovalId).toBeTruthy();
    expect(entry.productionAuthorizationId).toBeTruthy();

    const history = await app.inject({ method: 'GET', url: '/api/v1/opportunities/prod-ca7/renders' });
    expect(history.statusCode).toBe(200);
    expect(history.json().map((row: any) => row.renderId)).toEqual([entry.renderId]);
    expect(history.json()[0].state).toBe('SUCCEEDED');
  });

  it('honors an approved duration beyond 90 seconds exactly, without trims or fills (CA-8)', async () => {
    const { renderer, synthesizer } = productionFakes();
    renderer.renderDurationSeconds = 95;
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca8', [segment('s1', 0, 50), segment('s2', 1, 45)]);

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca8/production', payload: { actor: 'operator' } });
    expect(started.statusCode, JSON.stringify(started.json())).toBe(202);
    const detail = await waitForRenderState(started.json().renderId, 'SUCCEEDED');
    // The approved 95 seconds survive intact in the composition manifest.
    expect(renderer.manifests[0].source.finalDurationSeconds).toBe(95);
    const slotTotal = renderer.manifests[0].segments.reduce((total: number, item: any) => total + item.durationSeconds, 0);
    expect(slotTotal).toBe(95);
    expect(detail.output.durationSeconds).toBe(95);
  });

  it('invalid composition template fails SPECIFICATION at COMPOSITION with cause+action and no output', async () => {
    const { renderer, synthesizer } = productionFakes();
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-tpl-invalid', undefined, { compositionTemplate: 'no-existe' });

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-tpl-invalid/production', payload: { actor: 'operator' } });
    expect(started.statusCode).toBe(202);
    const failed = await waitForRenderState(started.json().renderId, 'FAILED');
    expect(failed.failureClass).toBe('SPECIFICATION');
    expect(failed.failureStage).toBe('COMPOSITION');
    expect(failed.failureCause).toContain('no-existe');
    expect(failed.failureSuggestedAction).toMatch(/register|choose/i);
    // No composition was written (htmlDocuments did not grow).
    expect(renderer.htmlDocuments).toHaveLength(0);
  });

  it('runs queued productions one at a time in visible order, each MP4 conforming to defaults (CA-9)', async () => {
    const { renderer, synthesizer } = productionFakes();
    app = buildApp(':memory:', { renderer, synthesizer });
    await reachRenderState('prod-ca9-a');
    await reachRenderState('prod-ca9-b');

    const first = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca9-a/production', payload: { actor: 'operator' } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-ca9-b/production', payload: { actor: 'operator' } });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);

    const queue = await app.inject({ method: 'GET', url: '/api/v1/renders' });
    expect(queue.json().map((row: any) => row.renderId)).toEqual(['prod-ca9-a-render-1', 'prod-ca9-b-render-1']);
    expect(queue.json().map((row: any) => row.position)).toEqual([1, 2]);

    await waitForRenderState('prod-ca9-a-render-1', 'SUCCEEDED');
    await waitForRenderState('prod-ca9-b-render-1', 'SUCCEEDED');

    // Serial execution: render time ranges never overlap.
    const sorted = [...renderer.renderRanges].sort((a, b) => a.start - b.start);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index].start).toBeGreaterThanOrEqual(sorted[index - 1].end);
    }
    // Each final video conforms to the technical defaults (fps 30, 1080x1920 for 9:16).
    expect(renderer.capturedRequests.map(request => request.fps)).toEqual([30, 30]);
    for (const html of renderer.htmlDocuments) {
      expect(html).toContain('data-width="1080" data-height="1920"');
    }
  });

  it('fails fast when standard layout template lacks required content-stack block (MISSING_BLOCK)', async () => {
    const { renderer, synthesizer } = productionFakes();
    app = buildApp(':memory:', { renderer, synthesizer, templatesRoot: FIXTURES });
    await reachRenderState('prod-tpl-missing-stack', undefined, { compositionTemplate: 'missing-stack' });

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-tpl-missing-stack/production', payload: { actor: 'operator' } });
    expect(started.statusCode).toBe(202);
    const failed = await waitForRenderState(started.json().renderId, 'FAILED');
    expect(failed.failureClass).toBe('SPECIFICATION');
    expect(failed.failureStage).toBe('COMPOSITION');
    expect(failed.failureCause).toContain('missing-stack');
    expect(failed.failureSuggestedAction).toContain('content-stack');
    // Fail-closed: no composition was written.
    expect(renderer.htmlDocuments).toHaveLength(0);
  });

  it('asymmetric layout template renders without content-stack wrap or bilateral anchors', async () => {
    const { renderer, synthesizer } = productionFakes();
    app = buildApp(':memory:', { renderer, synthesizer, templatesRoot: FIXTURES });
    await reachRenderState('prod-tpl-asymmetric', undefined, { compositionTemplate: 'asymmetric' });

    const started = await app.inject({ method: 'POST', url: '/api/v1/opportunities/prod-tpl-asymmetric/production', payload: { actor: 'operator' } });
    expect(started.statusCode).toBe(202);
    const succeeded = await waitForRenderState(started.json().renderId, 'SUCCEEDED');
    expect(succeeded.state).toBe('SUCCEEDED');
    expect(renderer.manifests[0].template.name).toBe('asymmetric');
    // Asymmetric opt-out: no content-stack wrap and no bilateral anchors injected by the builder.
    expect(renderer.htmlDocuments[0]).not.toContain('<div class="content-stack">');
    expect(renderer.htmlDocuments[0]).not.toContain('style="position:absolute; inset:0;"');
  });
});
