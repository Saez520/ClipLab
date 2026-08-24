import { describe, expect, it } from 'vitest';
import {
  assertOutputDuration,
  MAX_RATE_ADAPTATION_PASSES,
  renderAttemptSchema,
  renderFailureClassSchema,
  renderFailureSchema,
  renderQueueEntrySchema,
  renderResultSchema,
  renderStageSchema,
  renderStateSchema,
  RENDER_FAILURE_CLASSES,
  RENDER_STAGES,
  RENDER_STATES,
  resolveTechnicalOutput,
  technicalOutputSchema,
  DURATION_TOLERANCE_FRAMES
} from './render.js';
import { ProductionGateError, RenderEnvironmentError, RenderSpecificationError, RenderStateError, RenderUnclassifiedError, ValidationError } from './errors.js';

const validEntry = {
  renderId: 'opp-1-render-1',
  opportunityId: 'opp-1',
  storyboardId: 'opp-1-storyboard',
  storyboardRevisionId: 'opp-1-storyboard-revision-1',
  userApprovalId: 'opp-1-approval-1',
  productionAuthorizationId: '42',
  state: 'QUEUED' as const,
  stage: 'PREFLIGHT' as const,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z'
};

describe('technical output resolution', () => {
  it('resolves technical output defaults per environment profile and aspect ratio', () => {
    expect(resolveTechnicalOutput(undefined, '9:16')).toEqual({ fps: 30, width: 1080, height: 1920 });
    expect(resolveTechnicalOutput('development', '9:16')).toEqual({ fps: 30, width: 1080, height: 1920 });
    expect(resolveTechnicalOutput('production', '16:9')).toEqual({ fps: 30, width: 1920, height: 1080 });
    expect(resolveTechnicalOutput('production', '1:1')).toEqual({ fps: 30, width: 1080, height: 1080 });
    expect(technicalOutputSchema.parse(resolveTechnicalOutput('production', '9:16'))).toMatchObject({ fps: 30 });
  });

  it('rejects unknown aspect ratio or profile with ValidationError', () => {
    expect(() => resolveTechnicalOutput('development', '4:3')).toThrowError(ValidationError);
    expect(() => resolveTechnicalOutput('staging', '9:16')).toThrowError(ValidationError);
  });
});

describe('duration tolerance', () => {
  const fps = 30;
  const tolerance = DURATION_TOLERANCE_FRAMES / fps;

  it('accepts deviations within ±2 frames of the approved duration', () => {
    expect(() => assertOutputDuration(90, 90, fps)).not.toThrow();
    expect(() => assertOutputDuration(90 + tolerance, 90, fps)).not.toThrow();
    expect(() => assertOutputDuration(90 - tolerance, 90, fps)).not.toThrow();
  });

  it('rejects larger deviations with both durations in the message', () => {
    expect(() => assertOutputDuration(91.5, 90, fps)).toThrowError(/91\.5/);
    let details: unknown;
    try { assertOutputDuration(88.5, 90, fps); } catch (error) { details = (error as ValidationError).details; }
    expect((details as any).actualDurationSeconds).toBeCloseTo(88.5);
    expect((details as any).expectedDurationSeconds).toBe(90);
    expect((details as any).toleranceFrames).toBe(DURATION_TOLERANCE_FRAMES);
  });
});

describe('strict schemas', () => {
  it('accepts valid states, stages and failure classes only', () => {
    for (const state of RENDER_STATES) expect(renderStateSchema.safeParse(state).success).toBe(true);
    expect(renderStateSchema.safeParse('DONE').success).toBe(false);
    for (const stage of RENDER_STAGES) expect(renderStageSchema.safeParse(stage).success).toBe(true);
    expect(renderStageSchema.safeParse('RENDERING').success).toBe(false);
    for (const failureClass of RENDER_FAILURE_CLASSES) expect(renderFailureClassSchema.safeParse(failureClass).success).toBe(true);
    expect(renderFailureClassSchema.safeParse('UNKNOWN').success).toBe(false);
  });

  it('rejects extra fields on failure, result, entry and attempt schemas', () => {
    const failure = { failureClass: 'ENVIRONMENT', stage: 'PREFLIGHT', cause: 'ffmpeg missing', suggestedAction: 'install ffmpeg' };
    expect(renderFailureSchema.safeParse(failure).success).toBe(true);
    expect(renderFailureSchema.safeParse({ ...failure, extra: true }).success).toBe(false);

    const result = { outputPath: '/tmp/out.mp4', sha256: 'abc', durationSeconds: 90, width: 1080, height: 1920, fps: 30 };
    expect(renderResultSchema.safeParse(result).success).toBe(true);
    expect(renderResultSchema.safeParse({ ...result, bonus: 1 }).success).toBe(false);

    expect(renderQueueEntrySchema.safeParse(validEntry).success).toBe(true);
    expect(renderQueueEntrySchema.safeParse({ ...validEntry, unexpected: 1 }).success).toBe(false);

    const attempt = { attemptNumber: 1, actor: 'operator', startedAt: '2026-08-23T00:00:00.000Z' };
    expect(renderAttemptSchema.safeParse(attempt).success).toBe(true);
    expect(renderAttemptSchema.safeParse({ ...attempt, outcome: 'MAYBE' }).success).toBe(false);
  });
});

describe('production error contracts', () => {
  it('exposes stable codes and typed details', () => {
    const environment = new RenderEnvironmentError('ffmpeg is not installed', { check: 'ffmpeg -version' });
    expect(environment.code).toBe('RENDER_ENVIRONMENT');

    const specification = new RenderSpecificationError('Narration exceeds approved slot', { segmentId: 's1', slotSeconds: 30, producedSeconds: 44, validatorFindings: 'lint failed' });
    expect(specification.code).toBe('RENDER_SPECIFICATION');
    expect(specification.details).toMatchObject({ segmentId: 's1', slotSeconds: 30, producedSeconds: 44 });

    const unclassified = new RenderUnclassifiedError('Unknown engine crash', { rawLog: 'segfault', suggestedActions: ['retry once environment is verified', 'return to storyboard with correction'] });
    expect(unclassified.code).toBe('RENDER_UNCLASSIFIED');
    expect(unclassified.details?.suggestedActions).toHaveLength(2);

    expect(new RenderStateError().code).toBe('RENDER_STATE_INVALID');
    const gate = new ProductionGateError('Package no longer matches the approved revision', { reason: 'STALE_PACKAGE' });
    expect(gate.code).toBe('PRODUCTION_GATE_FAILED');
    expect(gate.details?.reason).toBe('STALE_PACKAGE');
  });

  it('keeps the maximum adaptation passes contract constant', () => {
    expect(MAX_RATE_ADAPTATION_PASSES).toBe(3);
  });
});
