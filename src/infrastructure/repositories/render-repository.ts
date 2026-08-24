import type Database from 'better-sqlite3';
import { NotFoundError, RenderStateError } from '../../domain/errors.js';
import { renderFailureSchema, renderQueueEntrySchema, renderStageSchema, type RenderFailure, type RenderQueueEntry, type RenderResult, type RenderStage } from '../../domain/render.js';

const now = () => new Date().toISOString();

/** Classification applied to renders found RUNNING by startup reconciliation:
 *  their producing process died, so the failure is environmental and the row
 *  stays recoverable through the operator retry path. */
const INTERRUPTED_FAILURE = {
  failureClass: 'ENVIRONMENT',
  cause: 'Render was interrupted while RUNNING: the producing process died (crash, OOM or redeploy) and no output was produced',
  suggestedAction: 'Verify the render environment (FFmpeg, TTS voices, resources) and retry from the operator endpoint'
} as const;

export type RenderRow = RenderQueueEntry & {
  /** Actor who last put this render into QUEUED (enqueue or explicit retry). */
  queuedBy: string;
  handoffPayload: unknown;
  outputPath?: string;
  outputSha256?: string;
  outputDurationSeconds?: number;
  failureClass?: string;
  failureCause?: string;
  failureStage?: string;
  failureSegmentId?: string;
  failureSuggestedAction?: string;
};

export type RenderAttemptRow = {
  attemptNumber: number;
  actor: string;
  startedAt: string;
  finishedAt?: string;
  outcome?: string;
  failureClass?: string;
  failureCause?: string;
  logExcerpt?: string;
};

type RawRender = Record<string, unknown>;

function toRow(raw: RawRender): RenderRow {
  const entry = renderQueueEntrySchema.parse({
    renderId: raw.render_id,
    opportunityId: raw.opportunity_id,
    storyboardId: raw.storyboard_id,
    storyboardRevisionId: raw.storyboard_revision_id,
    userApprovalId: raw.user_approval_id,
    productionAuthorizationId: raw.production_authorization_id,
    state: raw.state,
    stage: raw.stage,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  });
  return {
    ...entry,
    queuedBy: typeof raw.queued_by === 'string' && raw.queued_by.length > 0 ? raw.queued_by : 'system',
    handoffPayload: JSON.parse(raw.handoff_payload as string),
    ...(raw.output_path != null ? { outputPath: raw.output_path as string } : {}),
    ...(raw.output_sha256 != null ? { outputSha256: raw.output_sha256 as string } : {}),
    ...(raw.output_duration_seconds != null ? { outputDurationSeconds: raw.output_duration_seconds as number } : {}),
    ...(raw.failure_class != null ? { failureClass: raw.failure_class as string } : {}),
    ...(raw.failure_cause != null ? { failureCause: raw.failure_cause as string } : {}),
    ...(raw.failure_stage != null ? { failureStage: raw.failure_stage as string } : {}),
    ...(raw.failure_segment_id != null ? { failureSegmentId: raw.failure_segment_id as string } : {}),
    ...(raw.failure_suggested_action != null ? { failureSuggestedAction: raw.failure_suggested_action as string } : {})
  };
}

export class RenderRepository {
  constructor(private db: Database.Database) {}

  /** Persists the queue entry together with the full authorized package it was derived from. */
  enqueue(entry: RenderQueueEntry, handoffPayload: unknown, actor = 'system'): void {
    const t = now();
    this.transaction(() => {
      this.db.prepare(
        'INSERT INTO renders (render_id, opportunity_id, storyboard_id, storyboard_revision_id, user_approval_id, production_authorization_id, handoff_payload, state, stage, queued_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(entry.renderId, entry.opportunityId, entry.storyboardId, entry.storyboardRevisionId, entry.userApprovalId, entry.productionAuthorizationId, JSON.stringify(handoffPayload), entry.state, entry.stage, actor, t, t);
      this.event(entry.opportunityId, 'RENDER_QUEUED', actor, undefined, { renderId: entry.renderId });
    });
  }

  get(renderId: string): RenderRow {
    const raw = this.db.prepare('SELECT * FROM renders WHERE render_id=?').get(renderId) as RawRender | undefined;
    if (!raw) throw new NotFoundError(`Render ${renderId} not found`);
    return toRow(raw);
  }

  /** FIFO queue ordered by creation: every render with its position visible. */
  listQueue(): Array<RenderRow & { position: number }> {
    return this.listWhere('1=1');
  }

  listByOpportunity(opportunityId: string): Array<RenderRow & { position: number }> {
    return this.listWhere('opportunity_id=?', opportunityId);
  }

  private listWhere(where: string, param?: string): Array<RenderRow & { position: number }> {
    const rows = (param
      ? this.db.prepare(`SELECT * FROM renders WHERE ${where} ORDER BY created_at ASC, rowid ASC`).all(param)
      : this.db.prepare(`SELECT * FROM renders WHERE ${where} ORDER BY created_at ASC, rowid ASC`).all()) as RawRender[];
    return rows.map((raw, index) => ({ ...toRow(raw), position: index + 1 }));
  }

  /** SQL guard: only a QUEUED render may become RUNNING (single worker invariant). */
  markRunning(renderId: string): void {
    const result = this.db.prepare("UPDATE renders SET state='RUNNING', updated_at=? WHERE render_id=? AND state='QUEUED'").run(now(), renderId);
    if (result.changes !== 1) throw new RenderStateError(`Render ${renderId} is not QUEUED and cannot start running`);
  }

  /**
   * Re-queues a FAILED render on explicit operator demand. The retrying actor
   * becomes the new queued_by: whoever demands the execution owns the next
   * attempt's attribution.
   */
  requeueForRetry(renderId: string, actor: string): void {
    const result = this.db.prepare("UPDATE renders SET state='QUEUED', stage='PREFLIGHT', queued_by=?, updated_at=? WHERE render_id=? AND state='FAILED'").run(actor, now(), renderId);
    if (result.changes !== 1) throw new RenderStateError(`Render ${renderId} is not FAILED and cannot be requeued`);
  }

  /**
   * Startup-reconciliation guard: only a RUNNING render may be marked
   * interrupted. A row found RUNNING at service start belongs to a dead
   * previous process (crash, OOM, redeploy); it becomes a recoverable
   * ENVIRONMENT failure, the attempt the process left open is closed for
   * auditability, and lineage records the interruption. Zero automatic
   * retries: recovery stays operator-driven via the existing retry endpoint.
   */
  markInterrupted(renderId: string): void {
    this.transaction(() => {
      const updated = this.db.prepare(
        "UPDATE renders SET state='FAILED', failure_class=?, failure_cause=?, failure_stage=stage, failure_suggested_action=?, updated_at=? WHERE render_id=? AND state='RUNNING'"
      ).run(INTERRUPTED_FAILURE.failureClass, INTERRUPTED_FAILURE.cause, INTERRUPTED_FAILURE.suggestedAction, now(), renderId);
      if (updated.changes !== 1) throw new RenderStateError(`Render ${renderId} is not RUNNING and cannot be marked interrupted`);
      this.db.prepare("UPDATE render_attempts SET finished_at=?, outcome='FAILED', failure_class=?, failure_cause=? WHERE render_id=? AND finished_at IS NULL")
        .run(now(), INTERRUPTED_FAILURE.failureClass, INTERRUPTED_FAILURE.cause, renderId);
      const row = this.db.prepare('SELECT opportunity_id FROM renders WHERE render_id=?').get(renderId) as { opportunity_id: string } | undefined;
      if (row) {
        this.event(row.opportunity_id, 'RENDER_FAILED', 'startup-reconciliation', undefined, { renderId, ...INTERRUPTED_FAILURE, interrupted: true });
      }
    });
  }

  updateStage(renderId: string, stage: RenderStage): void {
    renderStageSchema.parse(stage);
    this.db.prepare('UPDATE renders SET stage=?, updated_at=? WHERE render_id=?').run(stage, now(), renderId);
  }

  recordAttemptStart(renderId: string, attemptNumber: number, actor: string, startedAt = now()): void {
    this.db.prepare('INSERT INTO render_attempts (render_id, attempt_number, actor, started_at) VALUES (?,?,?,?)').run(renderId, attemptNumber, actor, startedAt);
  }

  recordAttemptFinish(renderId: string, attemptNumber: number, outcome: 'SUCCEEDED' | 'FAILED', failure: { failureClass?: string; failureCause?: string; logExcerpt?: string } = {}, finishedAt = now()): void {
    this.db.prepare(
      'UPDATE render_attempts SET finished_at=?, outcome=?, failure_class=?, failure_cause=?, log_excerpt=? WHERE render_id=? AND attempt_number=?'
    ).run(finishedAt, outcome, failure.failureClass ?? null, failure.failureCause ?? null, failure.logExcerpt ?? null, renderId, attemptNumber);
  }

  attempts(renderId: string): RenderAttemptRow[] {
    return (this.db.prepare('SELECT * FROM render_attempts WHERE render_id=? ORDER BY attempt_number').all(renderId) as any[]).map(row => ({
      attemptNumber: row.attempt_number,
      actor: row.actor,
      startedAt: row.started_at,
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
      ...(row.outcome ? { outcome: row.outcome } : {}),
      ...(row.failure_class ? { failureClass: row.failure_class } : {}),
      ...(row.failure_cause ? { failureCause: row.failure_cause } : {}),
      ...(row.log_excerpt ? { logExcerpt: row.log_excerpt } : {})
    }));
  }

  nextAttemptNumber(renderId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(attempt_number),0)+1 AS next FROM render_attempts WHERE render_id=?').get(renderId) as any;
    return Number(row.next);
  }

  completeSuccess(renderId: string, result: RenderResult): void {
    this.transaction(() => {
      const updated = this.db.prepare(
        "UPDATE renders SET state='SUCCEEDED', stage='ENCODING', output_path=?, output_sha256=?, output_duration_seconds=?, updated_at=? WHERE render_id=?"
      ).run(result.outputPath, result.sha256, result.durationSeconds, now(), renderId);
      if (updated.changes !== 1) throw new NotFoundError(`Render ${renderId} not found`);
      this.event(this.get(renderId).opportunityId, 'RENDER_SUCCEEDED', 'production-worker', undefined, { renderId, outputPath: result.outputPath, durationSeconds: result.durationSeconds });
    });
  }

  completeFailure(renderId: string, failure: RenderFailure, logExcerpt?: string): void {
    renderFailureSchema.parse(failure);
    this.transaction(() => {
      const updated = this.db.prepare(
        "UPDATE renders SET state='FAILED', failure_class=?, failure_cause=?, failure_stage=?, failure_segment_id=?, failure_suggested_action=?, updated_at=? WHERE render_id=?"
      ).run(failure.failureClass, failure.cause, failure.stage, failure.segmentId ?? null, failure.suggestedAction, now(), renderId);
      if (updated.changes !== 1) throw new NotFoundError(`Render ${renderId} not found`);
      this.event(this.get(renderId).opportunityId, 'RENDER_FAILED', 'production-worker', failure.stage, { renderId, ...failure, logExcerpt });
    });
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private event(opportunityId: string, eventType: string, actor: string, toState: string | undefined, payload: unknown): void {
    this.db.prepare('INSERT INTO events (opportunity_id,event_type,from_state,to_state,actor,reason,payload,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(opportunityId, eventType, null, toState ?? null, actor, eventType === 'RENDER_FAILED' ? 'render failed' : null, payload ? JSON.stringify(payload) : null, now());
  }
}
