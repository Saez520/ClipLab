import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';
import { RenderRepository, type RenderRow } from './render-repository.js';
import { PipelineRepository } from './pipeline-repository.js';
import { NotFoundError, RenderStateError } from '../../domain/errors.js';
import type { RenderQueueEntry } from '../../domain/render.js';

const db = () => openDatabase(':memory:');

function entry(overrides: Partial<RenderQueueEntry> = {}): RenderQueueEntry {
  return {
    renderId: 'opp-1-render-1',
    opportunityId: 'opp-1',
    storyboardId: 'opp-1-storyboard',
    storyboardRevisionId: 'opp-1-storyboard-revision-1',
    userApprovalId: 'opp-1-approval-1',
    productionAuthorizationId: '42',
    state: 'QUEUED',
    stage: 'PREFLIGHT',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function seedOpportunity(database: Database.Database, opportunityId = 'opp-1'): void {
  const t = new Date().toISOString();
  database.prepare('INSERT INTO opportunities (opportunity_id,state,stable_state,blocked_reason,blocked_actor,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(opportunityId, 'RENDER', 'RENDER', null, null, t, t);
}

function seedHandoff(pipeline: PipelineRepository, opportunityId: string): void {
  pipeline.advance(opportunityId, 'STORYBOARD', 'RENDER', {
    opportunityId,
    state: 'AUTHORIZED_FOR_PRODUCTION'
  } as any, 'storyboard');
}

describe('render repository', () => {
  it('keeps queue order FIFO with visible positions across every state', () => {
    const database = db();
    seedOpportunity(database);
    const repo = new RenderRepository(database);
    repo.enqueue(entry({ renderId: 'r-1' }), { package: 'v1' });
    repo.enqueue(entry({ renderId: 'r-2', createdAt: new Date(Date.now() + 5).toISOString() }), { package: 'v1' });
    repo.markRunning('r-1');
    repo.updateStage('r-1', 'NARRATION');
    repo.completeFailure('r-2', { failureClass: 'ENVIRONMENT', stage: 'PREFLIGHT', cause: 'ffmpeg missing', suggestedAction: 'install ffmpeg and verify voices' });
    const queue = repo.listQueue();
    expect(queue.map(row => [row.renderId, row.state])).toEqual([['r-1', 'RUNNING'], ['r-2', 'FAILED']]);
    expect(queue.map(row => row.position)).toEqual([1, 2]);
    expect(queue[1].failureClass).toBe('ENVIRONMENT');
    database.close();
  });

  it('refuses to run a render that is not QUEUED', () => {
    const database = db();
    seedOpportunity(database);
    const repo = new RenderRepository(database);
    repo.enqueue(entry(), { package: 'v1' });
    repo.markRunning('opp-1-render-1');
    expect(() => repo.markRunning('opp-1-render-1')).toThrowError(RenderStateError);
    expect(repo.get('opp-1-render-1').state).toBe('RUNNING');
    database.close();
  });

  it('records every attempt with incremental numbers and unique constraint', () => {
    const database = db();
    seedOpportunity(database);
    const repo = new RenderRepository(database);
    repo.enqueue(entry(), { package: 'v1' });
    expect(repo.nextAttemptNumber('opp-1-render-1')).toBe(1);
    repo.recordAttemptStart('opp-1-render-1', 1, 'operator-a');
    repo.recordAttemptFinish('opp-1-render-1', 1, 'FAILED', { failureClass: 'ENVIRONMENT', failureCause: 'timeout', logExcerpt: 'killed after 600000ms' });
    expect(repo.nextAttemptNumber('opp-1-render-1')).toBe(2);
    repo.recordAttemptStart('opp-1-render-1', 2, 'operator-b');
    repo.recordAttemptFinish('opp-1-render-1', 2, 'SUCCEEDED');
    const attempts = repo.attempts('opp-1-render-1');
    expect(attempts.map(a => [a.attemptNumber, a.actor, a.outcome])).toEqual([[1, 'operator-a', 'FAILED'], [2, 'operator-b', 'SUCCEEDED']]);
    expect(attempts[0].failureCause).toBe('timeout');
    expect(attempts[0].logExcerpt).toContain('killed after');
    expect(() => repo.recordAttemptStart('opp-1-render-1', 2, 'duplicate')).toThrowError(/UNIQUE constraint failed/);
    database.close();
  });

  it('persists success result and failure details with lineage events', () => {
    const database = db();
    seedOpportunity(database);
    const pipeline = new PipelineRepository(database);
    seedHandoff(pipeline, 'opp-1');
    const repo = new RenderRepository(database);
    repo.enqueue(entry(), { package: 'v1' });

    repo.completeFailure('opp-1-render-1', { failureClass: 'SPECIFICATION', stage: 'VALIDATION', cause: 'lint failed', segmentId: 's1', suggestedAction: 'return to storyboard for correction and reapproval' }, 'findings excerpt');
    let row: RenderRow = repo.get('opp-1-render-1');
    expect(row.state).toBe('FAILED');
    expect(row.failureClass).toBe('SPECIFICATION');
    expect(row.failureStage).toBe('VALIDATION');
    expect(row.outputPath).toBeUndefined();

    repo.requeueForRetry('opp-1-render-1', 'operator-b');
    expect(repo.get('opp-1-render-1').state).toBe('QUEUED');
    expect(repo.get('opp-1-render-1').stage).toBe('PREFLIGHT');

    repo.completeSuccess('opp-1-render-1', { outputPath: '/data/renders/opp-1-render-1/output.mp4', sha256: 'deadbeef', durationSeconds: 90, width: 1080, height: 1920, fps: 30 });
    row = repo.get('opp-1-render-1');
    expect(row.state).toBe('SUCCEEDED');
    expect(row.outputPath).toBe('/data/renders/opp-1-render-1/output.mp4');
    expect(row.outputDurationSeconds).toBe(90);

    const lineage = pipeline.lineage('opp-1');
    const renderEvents = lineage.events.filter((e: any) => e.event_type.startsWith('RENDER_'));
    expect(renderEvents.map((e: any) => e.event_type)).toEqual(['RENDER_QUEUED', 'RENDER_FAILED', 'RENDER_SUCCEEDED']);
    database.close();
  });

  it('returns the latest persisted STORYBOARD handoff parsed or NotFound', () => {
    const database = db();
    seedOpportunity(database);
    const pipeline = new PipelineRepository(database);
    expect(() => pipeline.latestStoryboardHandoff('opp-1')).toThrowError(NotFoundError);
    seedHandoff(pipeline, 'opp-1');
    const handoff = pipeline.latestStoryboardHandoff('opp-1') as Record<string, unknown>;
    expect(handoff.opportunityId).toBe('opp-1');
    expect(handoff.state).toBe('AUTHORIZED_FOR_PRODUCTION');
    const again = pipeline.latestStoryboardHandoff('opp-1') as Record<string, unknown>;
    expect(again).toEqual(handoff);
    database.close();
  });

  it('records queued_by on enqueue and re-attributes it on explicit retry', () => {
    const database = db();
    seedOpportunity(database);
    const repo = new RenderRepository(database);
    // Default attribution when no actor is provided.
    repo.enqueue(entry({ renderId: 'r-default' }), { package: 'v1' });
    expect(repo.get('r-default').queuedBy).toBe('system');
    repo.enqueue(entry(), { package: 'v1' }, 'operator-a');
    expect(repo.get('opp-1-render-1').queuedBy).toBe('operator-a');

    repo.markRunning('opp-1-render-1');
    repo.completeFailure('opp-1-render-1', { failureClass: 'ENVIRONMENT', stage: 'VALIDATION', cause: 'disk full', suggestedAction: 'free space and retry' });
    repo.requeueForRetry('opp-1-render-1', 'operator-b');
    // The actor who demanded the re-execution owns the next attempt.
    expect(repo.get('opp-1-render-1').state).toBe('QUEUED');
    expect(repo.get('opp-1-render-1').queuedBy).toBe('operator-b');
    database.close();
  });

  it('markInterrupted transitions only RUNNING rows into a recoverable ENVIRONMENT failure', () => {
    const database = db();
    seedOpportunity(database);
    const repo = new RenderRepository(database);
    repo.enqueue(entry(), { package: 'v1' }, 'owner');
    // Guard: QUEUED rows are not orphans.
    expect(() => repo.markInterrupted('opp-1-render-1')).toThrowError(RenderStateError);

    repo.markRunning('opp-1-render-1');
    repo.updateStage('opp-1-render-1', 'COMPOSITION');
    repo.recordAttemptStart('opp-1-render-1', 1, 'owner');
    repo.markInterrupted('opp-1-render-1');

    const row = repo.get('opp-1-render-1');
    expect(row.state).toBe('FAILED');
    expect(row.failureClass).toBe('ENVIRONMENT');
    expect(row.failureCause).toMatch(/interrupted/i);
    expect(row.failureStage).toBe('COMPOSITION'); // stage at interruption preserved
    expect(row.failureSuggestedAction).toMatch(/retry/i);

    // The attempt the dead process left open is closed for auditability.
    const [attempt] = repo.attempts('opp-1-render-1');
    expect(attempt.outcome).toBe('FAILED');
    expect(attempt.finishedAt).toBeTruthy();
    expect(attempt.failureClass).toBe('ENVIRONMENT');

    // Second sweep finds nothing to do: guard fires again.
    expect(() => repo.markInterrupted('opp-1-render-1')).toThrowError(RenderStateError);
    database.close();
  });

  it('markInterrupted records lineage visible through the opportunity events', () => {
    const database = db();
    seedOpportunity(database);
    const pipeline = new PipelineRepository(database);
    seedHandoff(pipeline, 'opp-1');
    const repo = new RenderRepository(database);
    repo.enqueue(entry(), { package: 'v1' }, 'owner');
    repo.markRunning('opp-1-render-1');
    repo.markInterrupted('opp-1-render-1');
    const lineage = pipeline.lineage('opp-1');
    const renderEvents = lineage.events.filter((e: any) => e.event_type.startsWith('RENDER_'));
    expect(renderEvents.map((e: any) => e.event_type)).toEqual(['RENDER_QUEUED', 'RENDER_FAILED']);
    expect((renderEvents[1] as any).actor).toBe('startup-reconciliation');
    database.close();
  });
});
