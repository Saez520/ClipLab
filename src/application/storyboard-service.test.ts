import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../infrastructure/db/database.js';
import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { StoryboardRepository } from '../infrastructure/repositories/storyboard-repository.js';
import { SourceUnresolvedError, StoryboardApprovalRequiredError, StoryboardBlockedError } from '../domain/errors.js';
import { isPreferredDuration } from '../domain/storyboard.js';
import { StoryboardService } from './storyboard-service.js';

let db: any;
afterEach(() => db?.close());

function setup(references: Array<Record<string, unknown>> = []) {
  db = openDatabase(':memory:');
  const pipeline = new PipelineRepository(db);
  pipeline.create('o');
  pipeline.authorize('o', 'NOTE', 'DIRECTOR', 'director');
  pipeline.advance('o', 'NOTE', 'SCRIPT', { opportunityId: 'o', originalNote: 'note', directorDecision: 'APPROVE', centralApproach: 'approach' }, 'director');
  const narrative = new NarrativeRepository(db);
  const configuration = narrative.createConfiguration('o', 'configuration', { audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous', director: 'director' });
  narrative.approveConfiguration('o', configuration.configuration_id, 'user');
  const persistedReferences = references.length ? references : [{ raw: '[source.md:1]', path: 'source.md', locator: 'lines', startLine: 1, endLine: 1 }];
  const source = 'span-s1 span-s2 span-s3 audio-s1 audio-s2 audio-s3 visual-s1 visual-s2 visual-s3 meaning-s1 meaning-s2 meaning-s3 new visual revised visual change editorial wording';
  narrative.createScript('o', 'script', 'configuration', { narrativeText: 'span-s1 span-s2 span-s3 [source.md:1]', references: persistedReferences, sources: { 'source.md': source } }, 'DRAFT', 'narrator');
  narrative.setScriptState('o', 'script', 'READY_FOR_DIRECTOR_VALIDATION', 'narrator');
  const authorization = pipeline.authorizeNarrative('o', 'director');
  narrative.setScriptState('o', 'script', 'DIRECTOR_VALIDATED', 'director', { directorValidationId: 'validation', scriptAuthorization: String(authorization) });
  const storyboard = new StoryboardService(new StoryboardRepository(db), narrative, pipeline);
  return { pipeline, storyboard };
}

const segment = (id: string, position: number, dependsOn: string[] = []) => { const span = `span-${id}`; const narrativeStart = position * 8; return ({ segmentId: id, narrativeSpan: span, narrativeStart, narrativeEnd: narrativeStart + span.length, durationSeconds: 30, audio: `audio-${id}`, visualRepresentation: `visual-${id}`, audiovisualMapping: { narrativeMeaning: `meaning-${id}`, audio: `audio-${id}`, visual: `visual-${id}`, correspondence: `mapping-${id}` }, rhythm: 'steady', synchronization: 'sync', sourceReferences: [{ path: 'source.md', locator: '1', segmentId: id }], technicalCoverage: [], dependsOn }); };

describe('storyboard service', () => {
  it('builds, approves and exposes a complete handoff only with persisted authorization', () => {
    const { pipeline, storyboard } = setup();
    const created = storyboard.create('o', { actor: 'storyboard', segments: [segment('s1', 0)] });
    expect(created.state).toBe('STORYBOARD_READY_FOR_USER_APPROVAL');
    expect(() => storyboard.handoff('o')).toThrow();
    storyboard.approve('o', { actor: 'user', storyboardRevisionId: created.storyboardRevisionId });
    expect(() => storyboard.handoff('o')).toThrow();
    pipeline.authorize('o', 'STORYBOARD', 'STORYBOARD', 'user');
    expect(storyboard.handoff('o')).toMatchObject({ authorizationState: 'AUTHORIZED_FOR_PRODUCTION', finalDurationSeconds: 30 });
  });

  it('revalidates the corrected segment and its dependent while preserving unrelated versions', () => {
    const { storyboard } = setup();
    const created = storyboard.create('o', { segments: [segment('s1', 0), segment('s2', 1, ['s1']), segment('s3', 2)] });
    const corrected = storyboard.requestCorrection('o', { actor: 'user', segmentId: 's1', expectedAdjustment: 'new visual' });
    expect(corrected.affectedSegmentIds).toEqual(['s1', 's2']);
    expect(corrected.revision.segments[0].version).toBe(2);
    expect(corrected.revision.segments[1].version).toBe(2);
    expect(corrected.revision.segments[2].version).toBe(1);
    expect(corrected.revision.segments[1].visualRepresentation).toBe('visual-s2');
    expect(corrected.revision.segments[1].reviewNote).toContain('s1 changed');
    expect(() => storyboard.approve('o', { actor: 'user', storyboardRevisionId: created.storyboardRevisionId })).toThrow();
  });

  it('returns editorial corrections to the Director and requires explicit approval over 90 seconds', () => {
    const { pipeline, storyboard } = setup();
    const created = storyboard.create('o', { segments: [segment('s1', 0), { ...segment('s2', 1), durationSeconds: 61 }] });
    expect(created.finalDurationSeconds).toBe(91);
    expect(isPreferredDuration(created.finalDurationSeconds)).toBe(false);
    expect(() => storyboard.handoff('o')).toThrow(StoryboardApprovalRequiredError);
    storyboard.approve('o', { actor: 'user', storyboardRevisionId: created.storyboardRevisionId });
    pipeline.authorize('o', 'STORYBOARD', 'STORYBOARD', 'user');
    expect(storyboard.handoff('o').finalDurationSeconds).toBe(91);
    const correction = storyboard.requestCorrection('o', { actor: 'user', segmentId: 's1', expectedAdjustment: 'change editorial wording', editorialChange: true });
    expect(correction.revision.state).toBe('STORYBOARD_BLOCKED');
    expect(correction.revision.blockedRecipient).toBe('DIRECTOR');
  });

  it('resolves script references again when revalidating explicit segments', () => {
    const { storyboard } = setup([{ raw: '[source.md:1]', path: 'source.md', locator: 'lines', startLine: 1, endLine: 1 }]);
    storyboard.create('o', { segments: [segment('s1', 0)] });
  const unresolved = { ...segment('s1', 0), sourceReferences: [{ path: 'other.md', locator: '1', segmentId: 's1' }] };

    expect(() => storyboard.revalidate('o', { actor: 'user', segments: [unresolved] })).toThrow(SourceUnresolvedError);
    expect(storyboard.get('o').version).toBe(1);
  });

  it('invalidates persisted storyboard authorization when a correction is requested', () => {
    const { pipeline, storyboard } = setup();
    const created = storyboard.create('o', { segments: [segment('s1', 0)] });
    pipeline.authorize('o', 'STORYBOARD', 'STORYBOARD', 'user');

    storyboard.requestCorrection('o', { actor: 'user', segmentId: 's1', expectedAdjustment: 'new visual' });

    expect(pipeline.authorization('o', 'STORYBOARD', 'STORYBOARD')).toBeUndefined();
    expect(storyboard.get('o').storyboardRevisionId).not.toBe(created.storyboardRevisionId);
  });

  it('recalculates finalDurationSeconds from new segments on revalidate instead of inheriting the prior revision total', () => {
    const { storyboard } = setup();
    // Create with two segments of 30s each → total 60
    storyboard.create('o', { segments: [segment('s1', 0), segment('s2', 1)] });
    // Request correction to put revision into CORRECTION_REQUESTED state (required for revalidate)
    const correction = storyboard.requestCorrection('o', { actor: 'user', segmentId: 's1', expectedAdjustment: 'new visual' });
    expect(correction.revision.finalDurationSeconds).toBe(60);

    // Revalidate with segments of 40s and 50s → total must be 90, NOT the inherited 60
    const revalidated = storyboard.revalidate('o', {
      actor: 'storyboard',
      segments: [
        { ...segment('s1', 0), durationSeconds: 40 },
        { ...segment('s2', 1), durationSeconds: 50 }
      ]
    });

    expect(revalidated.finalDurationSeconds).toBe(90);
    expect(revalidated.segments[0].durationSeconds).toBe(40);
    expect(revalidated.segments[1].durationSeconds).toBe(50);
  });

  it('blocks unsupported corrections with a visible reason and recovers on a valid retry', () => {
    const { storyboard } = setup();
    storyboard.create('o', { segments: [segment('s1', 0)] });

    storyboard.requestCorrection('o', { actor: 'user', segmentId: 's1', expectedAdjustment: 'aerial drone shot over the city' });
    expect(() => storyboard.revalidate('o', { actor: 'storyboard' })).toThrow(StoryboardBlockedError);
    const blocked = storyboard.lineage('o').revisions.slice(-1)[0];
    expect(blocked.state).toBe('STORYBOARD_BLOCKED');
    expect(blocked.blockedReason).toContain('Unsupported claims');

    const retry = storyboard.requestCorrection('o', { actor: 'user', segmentId: 's1', expectedAdjustment: 'new visual' });
    expect(retry.revision.state).toBe('STORYBOARD_CORRECTION_REQUESTED');
    const revalidated = storyboard.revalidate('o', { actor: 'storyboard' });
    expect(revalidated.state).toBe('STORYBOARD_READY_FOR_USER_APPROVAL');
  });
});
