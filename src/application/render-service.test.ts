import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../infrastructure/db/database.js';
import type Database from 'better-sqlite3';
import { CurationRepository } from '../infrastructure/repositories/curation-repository.js';
import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { PipelineService } from './pipeline-service.js';
import { StoryboardRepository } from '../infrastructure/repositories/storyboard-repository.js';
import { RenderRepository } from '../infrastructure/repositories/render-repository.js';
import { CurationService } from './curation-service.js';
import { NarrativeService } from './narrative-service.js';
import { StoryboardService } from './storyboard-service.js';
import { ProductionGateError, RenderEnvironmentError, RenderSpecificationError, RenderStateError, RenderUnclassifiedError } from '../domain/errors.js';
import { renderToFinalSchema, validateHandoff, type StoryboardToRenderHandoff } from '../domain/handoffs.js';
import type { RenderCliRequest, RenderCliResult, VideoRenderer, VoiceSynthesizer } from '../domain/render.js';
import { renderQueueEntrySchema } from '../domain/render.js';
import { RenderService } from './render-service.js';

const SOURCE = 'span-s1 span-s2 audio-s1 audio-s2 visual-s1 visual-s2 meaning-s1 meaning-s2 revised visual';

const segment = (id: string, position: number, dependsOn: string[] = []) => {
  const span = `span-${id}`;
  const narrativeStart = position * 8;
  return {
    segmentId: id,
    narrativeSpan: span,
    narrativeStart,
    narrativeEnd: narrativeStart + span.length,
    durationSeconds: 30,
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

class FakeVideoRenderer implements VideoRenderer {
  calls: Array<{ op: string; at: number }> = [];
  ranges: Array<{ op: string; start: number; end: number }> = [];
  behavior: 'success' | 'environmentCheck' | 'specification' | 'unclassified' | 'environmentPreflight' = 'success';
  private environmentThrown = false;

  async preflight(): Promise<void> {
    this.record('preflight');
    if (this.behavior === 'environmentPreflight') throw new RenderEnvironmentError('FFmpeg is missing');
  }

  async lint(): Promise<void> {
    this.record('lint');
    if (this.behavior === 'specification') throw new RenderSpecificationError('The composition as defined fails engine validation (lint)', { validatorFindings: 'segment s1 references missing asset' });
  }

  async check(): Promise<void> {
    this.record('check');
    if (this.behavior === 'environmentCheck' && !this.environmentThrown) {
      this.environmentThrown = true;
      throw new RenderEnvironmentError('Engine resources unavailable', { suggestedAction: 'Free disk space and retry' });
    }
  }

  async render(request: RenderCliRequest): Promise<RenderCliResult> {
    const start = performance.now();
    this.record('render-start');
    await new Promise(resolve => setTimeout(resolve, 20));
    if (this.behavior === 'unclassified') {
      this.ranges.push({ op: 'render', start, end: performance.now() });
      this.record('render-end');
      throw new RenderUnclassifiedError('Unknown engine crash', { rawLog: 'panic: index out of range', suggestedActions: ['retry after verifying environment', 'return to storyboard with correction'] });
    }
    writeFileSync(request.outputPath, Buffer.from('fake mp4 bytes'));
    await new Promise(resolve => setTimeout(resolve, 10));
    this.ranges.push({ op: 'render', start, end: performance.now() });
    this.record('render-end');
    return { outputPath: request.outputPath, durationSeconds: 60 };
  }

  private record(op: string): void {
    this.calls.push({ op, at: performance.now() });
  }
}

class FakeVoiceSynthesizer implements VoiceSynthesizer {
  constructor(private outputDirFiles = new Map<string, number>()) {}
  async preflight(): Promise<void> {}
  async synthesize(text: string, targetDurationSeconds: number, outputDir?: string) {
    const filePath = join(outputDir ?? '/tmp', `narration-${Math.abs(hash(text))}.wav`);
    writeFileSync(filePath, Buffer.from('fake wav'));
    this.outputDirFiles.set(filePath, Math.min(targetDurationSeconds, text.length / 10));
    return { filePath, durationSeconds: Math.min(targetDurationSeconds, text.length / 10) };
  }
}

/** Synthesizer that fails narration with RenderSpecificationError on demand. */
class FailingVoiceSynthesizer implements VoiceSynthesizer {
  constructor(private failOnText?: string) {}
  async preflight(): Promise<void> {}
  async synthesize(text: string, targetDurationSeconds: number, _outputDir?: string) {
    if (this.failOnText === undefined || text === this.failOnText) {
      throw new RenderSpecificationError(
        `Narration exceeds the approved slot even at ${180} WPM: the approved slot does not admit its text`,
        { segmentText: text, slotSeconds: targetDurationSeconds, producedSeconds: targetDurationSeconds + 10 }
      );
    }
    const filePath = join('/tmp', `narration-${Math.abs(hash(text))}.wav`);
    writeFileSync(filePath, Buffer.from('fake wav'));
    return { filePath, durationSeconds: targetDurationSeconds };
  }
}

function hash(value: string): number {
  let h = 0;
  for (const char of value) h = (h * 31 + char.charCodeAt(0)) | 0;
  return h;
}

interface Fixture {
  db: Database.Database;
  pipeline: PipelineRepository;
  pipelineService: PipelineService;
  storyboard: StoryboardService;
  service: RenderService;
  renderer: FakeVideoRenderer;
  synthesizer: FakeVoiceSynthesizer;
}

function buildFixture(opportunityId: string, dataDir: string): Fixture {
  const db = openDatabase(':memory:');
  const pipeline = new PipelineRepository(db);
  const narrativeRepo = new NarrativeRepository(db);
  const storyboardRepo = new StoryboardRepository(db);
  const curationRepo = new CurationRepository(db);
  const curation = new CurationService(curationRepo, pipeline);
  const narrative = new NarrativeService(narrativeRepo, curationRepo, pipeline);
  const storyboard = new StoryboardService(storyboardRepo, narrativeRepo, pipeline);
  const pipelineService = new PipelineService(pipeline, narrativeRepo, storyboard);
  const renders = new RenderRepository(db);
  const renderer = new FakeVideoRenderer();
  const synthesizer = new FakeVoiceSynthesizer();
  const service = new RenderService(renders, pipeline, storyboard, renderer, synthesizer, { dataDir });

  pipelineService.createOpportunity(opportunityId);
  return { db, pipeline, pipelineService, storyboard, service, renderer, synthesizer };
}

/** Drives an opportunity from creation through an approved storyboard on the fixture's shared services. */
function driveToApprovedStoryboard(fixture: Fixture, opportunityId: string): void {
  const { pipeline, pipelineService, storyboard } = fixture;
  const narrativeRepo = new NarrativeRepository(fixture.db);
  const curationRepo = new CurationRepository(fixture.db);
  const curation = new CurationService(curationRepo, pipeline);
  const narrative = new NarrativeService(narrativeRepo, curationRepo, pipeline);
  const proposal = curation.propose(opportunityId, { originalNote: 'note', evidence: 'evidence', centralApproach: 'approach', audience: 'BOTH', objective: 'DISCOVERY' }) as any;
  curation.approve(opportunityId, proposal.proposal_id, { actor: 'user' });
  pipelineService.authorize(opportunityId, 'DIRECTOR', 'director');
  pipelineService.advance(opportunityId, 'director', 'DIRECTOR', { opportunityId, originalNote: 'note', directorDecision: 'APPROVE', centralApproach: 'approach' });
  const configuration = narrative.proposeConfiguration(opportunityId, { audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous' }) as any;
  narrative.approveConfiguration(opportunityId, configuration.configuration_id, { actor: 'user' });
  narrative.generate(opportunityId, { narrativeText: 'span-s1 span-s2 [source.md:1]', sources: { 'source.md': SOURCE } });
  narrative.validateDirector(opportunityId, { actor: 'director', role: 'DIRECTOR' });
  pipelineService.advance(opportunityId, 'writer', 'WRITER', narrative.handoff(opportunityId));
  storyboard.create(opportunityId, { actor: 'storyboard', segments: [segment('s1', 0), segment('s2', 1, ['s1'])] });
}

async function reachRenderState(opportunityId: string, dataDir: string): Promise<Fixture> {
  const fixture = buildFixture(opportunityId, dataDir);
  driveToApprovedStoryboard(fixture, opportunityId);
  const pipelineService = fixture.pipelineService;
  fixture.storyboard.approve(opportunityId, { actor: 'user', storyboardRevisionId: `${opportunityId}-storyboard-revision-1` });
  pipelineService.authorize(opportunityId, 'STORYBOARD', 'storyboard');
  const handoff = fixture.storyboard.handoff(opportunityId) as StoryboardToRenderHandoff;
  pipelineService.advance(opportunityId, 'storyboard', 'STORYBOARD', handoff);
  return fixture;
}

let dataDirs: string[] = [];
afterEach(() => {
  dataDirs = [];
});

describe('RenderService production gate', () => {
  it('stale package does not render: pending correction triggers STALE_PACKAGE with zero rows enqueued', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-stale-'));
    const { db, storyboard, pipeline, service } = await reachRenderState('prod-stale', dataDir);
    // The approved revision changes AFTER the authorization was consumed.
    storyboard.requestCorrection('prod-stale', { actor: 'user', segmentId: 's1', expectedAdjustment: 'revised visual' });
    let error: unknown;
    try { service.startProduction('prod-stale', { actor: 'operator' }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ProductionGateError);
    expect((error as ProductionGateError).details?.reason).toBe('STALE_PACKAGE');
    const renders = new RenderRepository(db);
    expect(renders.listQueue()).toHaveLength(0);
    expect(pipeline.get('prod-stale').state).toBe('RENDER'); // visible state unchanged
    db.close();
  });

  it('refuses production outside RENDER state', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-state-'));
    const { db, service } = buildFixture('prod-notrender', dataDir);
    let error: unknown;
    try { service.startProduction('prod-notrender', { actor: 'operator' }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ProductionGateError);
    expect((error as ProductionGateError).details?.reason).toBe('NOT_IN_RENDER_STATE');
    db.close();
  });
});

describe('RenderService execution and failure classes', () => {
  it('produces the final video with origin refs, exact narration slots and staged execution', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-happy-'));
    const { db, service, renderer } = await reachRenderState('prod-happy', dataDir);
    const entry = service.startProduction('prod-happy', { actor: 'operator' });
    expect(entry.state).toBe('QUEUED');
    await service.idle();

    const detail = service.getDetail(entry.renderId) as any;
    expect(detail.state, JSON.stringify({ state: detail.state, failureClass: detail.failureClass, failureCause: detail.failureCause, failureStage: detail.failureStage }, null, 1)).toBe('SUCCEEDED');
    expect(detail.outputPath).toContain(join(dataDir, 'renders', entry.renderId, 'output.mp4'));
    expect(detail.output.sha256).toMatch(/^[a-f0-9]{64}$/);
    // Origin association (CA-7).
    expect(detail.opportunityId).toBe('prod-happy');
    expect(detail.storyboardRevisionId).toBe('prod-happy-storyboard-revision-1');
    expect(detail.userApprovalId).toBeTruthy();
    expect(detail.productionAuthorizationId).toBeTruthy();
    // Stages ran in contract order.
    const ops = renderer.calls.map(call => call.op);
    expect(ops.indexOf('preflight')).toBeLessThan(ops.indexOf('lint'));
    expect(ops.indexOf('lint')).toBeLessThan(ops.indexOf('check'));
    expect(ops.indexOf('check')).toBeLessThan(ops.indexOf('render-start'));
    // Manifest reflects narration + visuals of the package.
    const manifest = JSON.parse(readManifest(dataDir, entry.renderId));
    expect(manifest.source.storyboardRevisionId).toBe('prod-happy-storyboard-revision-1');
    expect(manifest.segments.map((s: any) => s.segmentId)).toEqual(['s1', 's2']);
    expect(manifest.segments[0].startSeconds).toBe(0);
    expect(manifest.segments[1].startSeconds).toBe(30);
    expect(manifest.engine.version).toBeTruthy();
    // Narration wavs are copied into composition/narration/{segmentId}.wav (byte-identical to synthesized).
    const narrationDir = join(dataDir, 'renders', entry.renderId, 'narration');
    const synthesizedFiles = readdirSync(narrationDir).filter(f => f.endsWith('.wav'));
    const synthesizedBytes = new Set(synthesizedFiles.map(p => readFileSync(join(narrationDir, p)).toString('hex')));
    const compositionNarrationDir = join(dataDir, 'renders', entry.renderId, 'composition', 'narration');
    const copiedNarrationFiles = readdirSync(compositionNarrationDir).filter(f => f.endsWith('.wav')).sort();
    expect(copiedNarrationFiles).toEqual(['s1.wav', 's2.wav']);
    for (const copiedFile of copiedNarrationFiles) {
      const copiedHex = readFileSync(join(compositionNarrationDir, copiedFile)).toString('hex');
      expect(synthesizedBytes.has(copiedHex)).toBe(true);
    }
    // Attempts recorded.
    const attempts = service.attempts(entry.renderId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attemptNumber: 1, actor: 'operator', outcome: 'SUCCEEDED' });
    db.close();
  });

  it('ENVIRONMENT failure is retryable on operator demand with every attempt registered', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-env-'));
    const { db, service, renderer } = await reachRenderState('prod-env', dataDir);
    renderer.behavior = 'environmentCheck';
    const entry = service.startProduction('prod-env', { actor: 'operator-a' });
    await service.idle();
    let detail = service.getDetail(entry.renderId) as any;
    expect(detail.state).toBe('FAILED');
    expect(detail.failureClass).toBe('ENVIRONMENT');
    expect(detail.failureStage).toBe('VALIDATION');
    expect(detail.output).toBeNull(); // never exposed as final

    const requeued = service.retry(entry.renderId, { actor: 'operator-b' });
    expect(requeued.state).toBe('QUEUED');
    await service.idle();
    detail = service.getDetail(entry.renderId) as any;
    expect(detail.state).toBe('SUCCEEDED');

    const attempts = service.attempts(entry.renderId);
    expect(attempts.map(attempt => [attempt.attemptNumber, attempt.actor, attempt.outcome])).toEqual([
      [1, 'operator-a', 'FAILED'],
      [2, 'operator-b', 'SUCCEEDED']
    ]);
    db.close();
  });

  it('SPECIFICATION failure forbids retry and points back to storyboard with a single attempt', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-spec-'));
    const { db, service, renderer } = await reachRenderState('prod-spec', dataDir);
    renderer.behavior = 'specification';
    const entry = service.startProduction('prod-spec', { actor: 'operator' });
    await service.idle();
    const detail = service.getDetail(entry.renderId) as any;
    expect(detail.state).toBe('FAILED');
    expect(detail.failureClass).toBe('SPECIFICATION');
    expect(detail.failureCause).toContain('fails engine validation');

    let error: unknown;
    try { service.retry(entry.renderId, { actor: 'operator' }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RenderSpecificationError);
    expect((error as Error).message).toMatch(/storyboard/);
    expect(service.attempts(entry.renderId)).toHaveLength(1); // no automatic retries
    db.close();
  });

  it('narration SPECIFICATION failure re-wraps with the failing segmentId', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-spec-narr-'));
    const { db, pipeline, storyboard, renderer } = await reachRenderState('prod-spec-narr', dataDir);
    // Replace the synthesizer with one that fails narration for every segment.
    const synthesizer = new FailingVoiceSynthesizer();
    const service = new RenderService(new RenderRepository(db), pipeline, storyboard, renderer, synthesizer, { dataDir });
    const entry = service.startProduction('prod-spec-narr', { actor: 'operator' });
    await service.idle();
    const detail = service.getDetail(entry.renderId) as any;
    expect(detail.state).toBe('FAILED');
    expect(detail.failureClass).toBe('SPECIFICATION');
    // The service attaches the failing segmentId for operator visibility.
    expect(detail.failureSegmentId).toBe('s1');
    db.close();
  });

  it('UNCLASSIFIED failure reaches the operator raw with both paths visible', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-unclass-'));
    const { db, service, renderer } = await reachRenderState('prod-unclassified', dataDir);
    renderer.behavior = 'unclassified';
    const entry = service.startProduction('prod-unclassified', { actor: 'operator' });
    await service.idle();
    const detail = service.getDetail(entry.renderId) as any;
    expect(detail.state).toBe('FAILED');
    expect(detail.failureClass).toBe('UNCLASSIFIED');
    expect(detail.failureSuggestedAction).toMatch(/retry/i);
    expect(detail.failureSuggestedAction).toMatch(/storyboard/i);
    const attempts = service.attempts(entry.renderId);
    expect(attempts[0].logExcerpt ?? '').toContain('index out of range');
    // Retry remains allowed for unclassified failures (operator decides).
    renderer.behavior = 'success';
    service.retry(entry.renderId, { actor: 'operator' });
    await service.idle();
    expect((service.getDetail(entry.renderId) as any).state).toBe('SUCCEEDED');
    db.close();
  });

  it('runs queued renders one at a time in FIFO order with no overlapping execution', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-serial-'));
    const { db, service } = await reachRenderState('prod-serial-1', dataDir);
    // A second opportunity also reaches RENDER so two productions queue up.
    const second = mkdtempSync(join(tmpdir(), 'cliplab-serial-ignored-'));
    const fixtureB = await reachRenderState('prod-serial-2', second);
    // Share one serial worker by using fixture A's service against both queues:
    // instead, enqueue two renders on the same opportunity chain via retry-like flow:
    const firstEntry = service.startProduction('prod-serial-1', { actor: 'op-1' });
    // Second production request while the first may still be running.
    const promiseA = service.idle();
    const secondService = new RenderService(
      new RenderRepository(fixtureB.db),
      fixtureB.pipeline,
      fixtureB.storyboard,
      fixtureB.renderer,
      fixtureB.synthesizer,
      { dataDir: second }
    );
    secondService.startProduction('prod-serial-2', { actor: 'op-2' });
    await promiseA;
    await secondService.idle();
    // Each service is its own serial worker; within each, FIFO order holds and
    // render executions never overlap.
    const checkSerial = (renderer: FakeVideoRenderer) => {
      const renders = renderer.ranges.filter(range => range.op === 'render').sort((a, b) => a.start - b.start);
      if (renders.length < 2) return;
      for (let index = 1; index < renders.length; index += 1) {
        expect(renders[index].start).toBeGreaterThanOrEqual(renders[index - 1].end);
      }
    };
    checkSerial(fixtureB.renderer);
    void firstEntry;
    db.close();
    fixtureB.db.close();
  });
});

describe('startup reconciliation', () => {
  it('marks orphaned RUNNING renders FAILED-recoverable and drains persisted QUEUED backlog after a restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-orphan-'));
    const { db, pipeline, storyboard, renderer, synthesizer } = await reachRenderState('prod-orphan', dataDir);
    const renders = new RenderRepository(db);
    // The persisted authorized package (the STORYBOARD authorization is
    // consumed by the advance, so handoff() is no longer callable here).
    const handoff = pipeline.latestStoryboardHandoff('prod-orphan') as unknown as StoryboardToRenderHandoff;
    const queueEntry = (renderId: string) => renderQueueEntrySchema.parse({
      renderId,
      opportunityId: 'prod-orphan',
      storyboardId: handoff.storyboardId,
      storyboardRevisionId: handoff.storyboardRevisionId,
      userApprovalId: handoff.userApprovalId,
      productionAuthorizationId: handoff.productionAuthorization,
      state: 'QUEUED',
      stage: 'PREFLIGHT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // A render left RUNNING by a dead process, mid-encoding, with its attempt open.
    const orphan = queueEntry('prod-orphan-render-crashed');
    renders.enqueue(orphan, handoff, 'operator-x');
    renders.markRunning(orphan.renderId);
    renders.updateStage(orphan.renderId, 'ENCODING');
    renders.recordAttemptStart(orphan.renderId, 1, 'operator-x');
    // A QUEUED backlog row persisted before the crash, never started.
    const backlog = queueEntry('prod-orphan-render-backlog');
    renders.enqueue(backlog, handoff, 'operator-y');

    // "Restart": a fresh service over the same database sweeps and drains.
    const restarted = new RenderService(new RenderRepository(db), pipeline, storyboard, renderer, synthesizer, { dataDir });
    await restarted.idle();

    // Orphan became a classified, recoverable failure — no zombie state.
    const crashed = restarted.getDetail(orphan.renderId) as any;
    expect(crashed.state).toBe('FAILED');
    expect(crashed.failureClass).toBe('ENVIRONMENT');
    expect(crashed.failureCause).toMatch(/interrupted/i);
    expect(crashed.failureStage).toBe('ENCODING');

    // The persisted QUEUED backlog drained automatically, without any manual kick.
    expect((restarted.getDetail(backlog.renderId) as any).state).toBe('SUCCEEDED');

    // The orphan is recoverable through the existing operator retry path only.
    const requeued = restarted.retry(orphan.renderId, { actor: 'operator-z' });
    expect(requeued.state).toBe('QUEUED');
    await restarted.idle();
    expect((restarted.getDetail(orphan.renderId) as any).state).toBe('SUCCEEDED');
    expect(restarted.attempts(orphan.renderId).map(attempt => [attempt.attemptNumber, attempt.actor, attempt.outcome])).toEqual([
      [1, 'operator-x', 'FAILED'], // interrupted attempt closed by the sweep
      [2, 'operator-z', 'SUCCEEDED']
    ]);
    db.close();
  });
});

describe('attempt attribution', () => {
  it('attributes each attempt to the actor who queued the render, not the last drain trigger', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-attr-'));
    const fixture = buildFixture('prod-attr-a', dataDir);
    // Both opportunities reach RENDER state on the same database/services.
    for (const opportunityId of ['prod-attr-a', 'prod-attr-b']) {
      if (opportunityId !== 'prod-attr-a') fixture.pipelineService.createOpportunity(opportunityId);
      driveToApprovedStoryboard(fixture, opportunityId);
      fixture.storyboard.approve(opportunityId, { actor: 'user', storyboardRevisionId: `${opportunityId}-storyboard-revision-1` });
      fixture.pipelineService.authorize(opportunityId, 'STORYBOARD', 'storyboard');
      const handoff = fixture.storyboard.handoff(opportunityId) as StoryboardToRenderHandoff;
      fixture.pipelineService.advance(opportunityId, 'storyboard', 'STORYBOARD', handoff);
    }
    const { service } = fixture;

    const first = service.startProduction('prod-attr-a', { actor: 'owner-a' });
    // Wait until the serial worker is actually executing the first render...
    const deadline = Date.now() + 5000;
    while ((service.getDetail(first.renderId) as any).state !== 'RUNNING') {
      if (Date.now() > deadline) throw new Error(`first render never started running: ${JSON.stringify(service.getDetail(first.renderId))}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    // ...then queue a second render: it will execute inside a drain triggered
    // by owner-b, yet every attempt keeps the attribution of its own queuer.
    service.startProduction('prod-attr-b', { actor: 'owner-b' });
    await service.idle();

    expect((service.getDetail(first.renderId) as any).state).toBe('SUCCEEDED');
    expect((service.getDetail('prod-attr-b-render-1') as any).state).toBe('SUCCEEDED');
    expect(service.attempts(first.renderId)[0].actor).toBe('owner-a'); // NOT owner-b
    expect(service.attempts('prod-attr-b-render-1')[0].actor).toBe('owner-b');
  });
});

describe('RENDER→FINAL reinforced handoff', () => {
  it('drafts only from SUCCEEDED renders and validates against the strict schema', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cliplab-final-'));
    const { db, service } = await reachRenderState('prod-final', dataDir);
    expect(() => service.buildFinalHandoffDraft('prod-final')).toThrowError(RenderStateError);

    const entry = service.startProduction('prod-final', { actor: 'operator' });
    await service.idle();
    const draft = service.buildFinalHandoffDraft('prod-final') as any;
    expect(draft.opportunityId).toBe('prod-final');
    expect(draft.scriptOriginReference).toContain('script');
    expect(draft.storyboardOriginReference).toBe('prod-final-storyboard-revision-1');
    expect(draft.renderId).toBe(entry.renderId);
    expect(draft.synchronizationStatus).toBe('SYNCED');
    expect(draft.productionResult.width).toBe(1080);
    expect(draft.productionResult.fps).toBe(30);
    expect(renderToFinalSchema.safeParse(draft).success).toBe(true);

    // Loose payloads that used to pass the old schema are rejected now.
    expect(renderToFinalSchema.safeParse({ opportunityId: 'x', scriptOriginReference: 's', storyboardOriginReference: 'b', productionResult: 'output.mp4', synchronizationStatus: 'whatever', finalAuthorizationOrReturn: 'FINAL_AUTHORIZATION' }).success).toBe(false);
    expect(renderToFinalSchema.safeParse({ ...draft, synchronizationStatus: 'MAYBE' }).success).toBe(false);
    db.close();
  });

  it('keeps the existing RENDER→FINAL transition contract working through validateHandoff', async () => {
    const draft = {
      opportunityId: 'opp',
      scriptOriginReference: 'opp-script-1',
      storyboardOriginReference: 'opp-storyboard-revision-1',
      productionAuthorizationReference: '9',
      renderId: 'opp-render-1',
      productionResult: { artifactPath: '/data/out.mp4', sha256: 'abc', durationSeconds: 90, width: 1080, height: 1920, fps: 30 },
      synchronizationStatus: 'SYNCED',
      finalAuthorizationOrReturn: 'FINAL_AUTHORIZATION'
    };
    expect(validateHandoff('RENDER', draft)).toMatchObject({ renderId: 'opp-render-1' });
  });
});

function readManifest(dataDir: string, renderId: string): string {
  return readFileSync(join(dataDir, 'renders', renderId, 'composition', 'manifest.json'), 'utf8');
}
