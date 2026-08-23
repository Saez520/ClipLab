import type Database from 'better-sqlite3';
import { NotFoundError, StoryboardStateError } from '../../domain/errors.js';
import { assertStoryboardTransition, storyboardRevisionSchema, storyboardSchema, type Storyboard, type StoryboardCorrection, type StoryboardRevision, type StoryboardSegment } from '../../domain/storyboard.js';

const now = () => new Date().toISOString();

export type StoryboardRevisionInput = Omit<StoryboardRevision, 'createdAt'> & { createdAt?: string };

export class StoryboardRepository {
  constructor(private db: Database.Database) {}

  private opportunity(opportunityId: string) {
    if (!this.db.prepare('SELECT opportunity_id FROM opportunities WHERE opportunity_id=?').get(opportunityId)) throw new NotFoundError();
  }

  createRevision(input: StoryboardRevisionInput, actor: string): StoryboardRevision {
    const revision = storyboardRevisionSchema.parse({ ...input, createdAt: input.createdAt ?? now() });
    return this.transaction(() => {
      this.opportunity(revision.opportunityId);
      let root = this.db.prepare('SELECT * FROM storyboards WHERE opportunity_id=?').get(revision.opportunityId) as any;
      if (!root) {
        this.db.prepare('INSERT INTO storyboards(storyboard_id,opportunity_id,current_revision_id,current_revision_version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run(revision.storyboardId, revision.opportunityId, revision.storyboardRevisionId, revision.version, revision.state, revision.createdAt, revision.createdAt);
      } else if (root.storyboard_id !== revision.storyboardId) {
        throw new StoryboardStateError('An opportunity can only have one storyboard root');
      }
      this.db.prepare('INSERT INTO storyboard_revisions(revision_id,storyboard_id,opportunity_id,version,script_id,director_validation_id,script_authorization,state,profile,final_duration_seconds,target_duration_seconds,payload,blocked_reason,blocked_recipient,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(revision.storyboardRevisionId, revision.storyboardId, revision.opportunityId, revision.version, revision.scriptId, revision.directorValidationId, revision.scriptAuthorization, revision.state, JSON.stringify(revision.profile), revision.finalDurationSeconds, revision.targetDurationSeconds ?? null, JSON.stringify(revision), revision.blockedReason ?? null, revision.blockedRecipient ?? null, revision.createdAt);
      for (const segment of revision.segments) {
        this.db.prepare('INSERT INTO storyboard_segments(revision_id,segment_id,version,position,payload,created_at) VALUES(?,?,?,?,?,?)')
          .run(revision.storyboardRevisionId, segment.segmentId, segment.version, segment.position, JSON.stringify(segment), revision.createdAt);
        for (const source of segment.sourceReferences) {
          this.db.prepare('INSERT INTO storyboard_sources(revision_id,segment_id,path,locator,content,summary,payload,created_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(revision.storyboardRevisionId, segment.segmentId, source.path, source.locator, source.content ?? null, source.summary ?? null, JSON.stringify(source), revision.createdAt);
        }
        this.db.prepare('INSERT INTO storyboard_validations(revision_id,segment_id,payload,created_at) VALUES(?,?,?,?)')
          .run(revision.storyboardRevisionId, segment.segmentId, JSON.stringify(segment.validation), revision.createdAt);
      }
      for (const correction of revision.corrections) this.insertCorrection(revision, correction);
      this.db.prepare('UPDATE storyboards SET current_revision_id=?,current_revision_version=?,state=?,updated_at=? WHERE storyboard_id=?')
        .run(revision.storyboardRevisionId, revision.version, revision.state, revision.createdAt, revision.storyboardId);
      this.event(revision.opportunityId, revision.storyboardId, revision.storyboardRevisionId, 'REVISION_CREATED', actor, revision.blockedReason, revision);
      return this.getRevision(revision.opportunityId, revision.storyboardRevisionId);
    });
  }

  get(opportunityId: string): Storyboard {
    const row = this.db.prepare('SELECT * FROM storyboards WHERE opportunity_id=?').get(opportunityId) as any;
    if (!row) throw new NotFoundError('Storyboard not found');
    return storyboardSchema.parse({ opportunityId: row.opportunity_id, storyboardId: row.storyboard_id, currentRevisionId: row.current_revision_id, currentRevisionVersion: row.current_revision_version, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at });
  }

  getRevision(opportunityId: string, revisionId?: string): StoryboardRevision {
    const row = revisionId
      ? this.db.prepare('SELECT * FROM storyboard_revisions WHERE opportunity_id=? AND revision_id=?').get(opportunityId, revisionId)
      : this.db.prepare('SELECT * FROM storyboard_revisions WHERE opportunity_id=? ORDER BY version DESC LIMIT 1').get(opportunityId);
    if (!row) throw new NotFoundError('Storyboard revision not found');
    return storyboardRevisionSchema.parse(JSON.parse((row as any).payload));
  }

  history(opportunityId: string) {
    this.opportunity(opportunityId);
    const revisions = this.db.prepare('SELECT payload FROM storyboard_revisions WHERE opportunity_id=? ORDER BY version').all(opportunityId).map((row: any) => storyboardRevisionSchema.parse(JSON.parse(row.payload)));
    const approvals = this.db.prepare('SELECT * FROM storyboard_approvals WHERE opportunity_id=? ORDER BY approved_at').all(opportunityId);
    const corrections = this.db.prepare('SELECT * FROM storyboard_corrections WHERE opportunity_id=? ORDER BY requested_at').all(opportunityId);
    const validations = this.db.prepare('SELECT * FROM storyboard_validations WHERE revision_id IN (SELECT revision_id FROM storyboard_revisions WHERE opportunity_id=?) ORDER BY id').all(opportunityId).map((row: any) => ({ ...row, payload: JSON.parse(row.payload) }));
    const events = this.db.prepare('SELECT * FROM storyboard_events WHERE opportunity_id=? ORDER BY id').all(opportunityId).map((row: any) => ({ ...row, payload: row.payload ? JSON.parse(row.payload) : undefined }));
    return { storyboard: this.get(opportunityId), revisions, approvals, corrections, validations, events };
  }

  approval(opportunityId: string, revisionId: string) {
    return this.db.prepare('SELECT * FROM storyboard_approvals WHERE opportunity_id=? AND revision_id=? ORDER BY approved_at DESC LIMIT 1').get(opportunityId, revisionId) as any;
  }

  approve(opportunityId: string, storyboardId: string, revisionId: string, actor: string, approvalId: string) {
    const revision = this.getRevision(opportunityId, revisionId);
    if (revision.storyboardId !== storyboardId) throw new StoryboardStateError('Storyboard revision does not belong to the storyboard root');
    if (revision.state !== 'STORYBOARD_READY_FOR_USER_APPROVAL') throw new StoryboardStateError('Only a storyboard ready for user approval can be approved');
    const current = this.get(opportunityId);
    if (current.currentRevisionId !== revisionId) throw new StoryboardStateError('Only the current storyboard revision can be approved');
    return this.transaction(() => {
      const approvedAt = now();
      this.db.prepare('INSERT INTO storyboard_approvals(approval_id,opportunity_id,storyboard_id,revision_id,actor,approved_at) VALUES(?,?,?,?,?,?)').run(approvalId, opportunityId, storyboardId, revisionId, actor, approvedAt);
      this.db.prepare('UPDATE storyboard_revisions SET state=?,payload=? WHERE revision_id=?').run('STORYBOARD_USER_APPROVED', JSON.stringify({ ...revision, state: 'STORYBOARD_USER_APPROVED' }), revisionId);
      this.db.prepare('UPDATE storyboards SET state=?,updated_at=? WHERE storyboard_id=?').run('STORYBOARD_USER_APPROVED', approvedAt, storyboardId);
      this.event(opportunityId, storyboardId, revisionId, 'USER_APPROVED', actor, undefined, { approvalId, revisionId });
      return { approvalId, revisionId, actor, approvedAt, revision: this.getRevision(opportunityId, revisionId) };
    });
  }

  addCorrection(opportunityId: string, storyboardId: string, revisionId: string, correction: StoryboardCorrection) {
    const revision = this.getRevision(opportunityId, revisionId);
    this.insertCorrection(revision, correction);
    this.event(opportunityId, storyboardId, revisionId, 'CORRECTION_REQUESTED', correction.requestedBy, correction.expectedAdjustment, correction);
    return correction;
  }

  private insertCorrection(revision: StoryboardRevision, correction: StoryboardCorrection) {
    const correctionId = correction.correctionId ?? `${revision.opportunityId}-correction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.db.prepare('SELECT 1 FROM storyboard_corrections WHERE correction_id=?').get(correctionId)) return;
    this.db.prepare('INSERT INTO storyboard_corrections(correction_id,opportunity_id,storyboard_id,revision_id,segment_id,expected_adjustment,requested_by,status,editorial_change,recipient,requested_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(correctionId, revision.opportunityId, revision.storyboardId, revision.storyboardRevisionId, correction.segmentId, correction.expectedAdjustment, correction.requestedBy, correction.status, correction.editorialChange ? 1 : 0, correction.recipient, correction.requestedAt ?? revision.createdAt, JSON.stringify({ ...correction, correctionId }));
  }

  pendingCorrections(opportunityId: string, revisionId?: string): StoryboardCorrection[] {
    const rows = revisionId
      ? this.db.prepare("SELECT payload FROM storyboard_corrections WHERE opportunity_id=? AND revision_id=? AND status='PENDING'").all(opportunityId, revisionId)
      : this.db.prepare("SELECT payload FROM storyboard_corrections WHERE opportunity_id=? AND status='PENDING'").all(opportunityId);
    return rows.map((row: any) => JSON.parse(row.payload) as StoryboardCorrection);
  }

  resolveCorrections(opportunityId: string) {
    this.db.prepare("UPDATE storyboard_corrections SET status='APPLIED', payload=json_set(payload, '$.status', 'APPLIED') WHERE opportunity_id=? AND status='PENDING'").run(opportunityId);
  }

  markSuperseded(opportunityId: string, revisionId: string, actor: string) {
    const revision = this.getRevision(opportunityId, revisionId);
    assertStoryboardTransition(revision.state, 'STORYBOARD_SUPERSEDED');
    this.db.prepare('UPDATE storyboard_revisions SET state=?,payload=? WHERE revision_id=?').run('STORYBOARD_SUPERSEDED', JSON.stringify({ ...revision, state: 'STORYBOARD_SUPERSEDED' }), revisionId);
    this.event(opportunityId, revision.storyboardId, revisionId, 'REVISION_SUPERSEDED', actor);
  }

  updateRevisionState(opportunityId: string, revisionId: string, state: StoryboardRevision['state'], actor: string, reason?: string, recipient?: string) {
    const revision = this.getRevision(opportunityId, revisionId);
    assertStoryboardTransition(revision.state, state);
    const updated = storyboardRevisionSchema.parse({ ...revision, state, ...(reason ? { blockedReason: reason, blockedRecipient: recipient } : {}) });
    this.db.prepare('UPDATE storyboard_revisions SET state=?,payload=?,blocked_reason=?,blocked_recipient=? WHERE revision_id=?').run(state, JSON.stringify(updated), reason ?? null, recipient ?? null, revisionId);
    this.db.prepare('UPDATE storyboards SET state=?,updated_at=? WHERE storyboard_id=?').run(state, now(), revision.storyboardId);
    this.event(opportunityId, revision.storyboardId, revisionId, state, actor, reason, updated);
    return updated;
  }

  event(opportunityId: string, storyboardId: string, revisionId: string | undefined, eventType: string, actor: string, reason?: string, payload?: unknown) {
    this.db.prepare('INSERT INTO storyboard_events(opportunity_id,storyboard_id,revision_id,event_type,actor,reason,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(opportunityId, storyboardId, revisionId ?? null, eventType, actor, reason ?? null, payload ? JSON.stringify(payload) : null, now());
  }

  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }
}
