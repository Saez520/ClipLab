import type Database from 'better-sqlite3';
import { NotFoundError, NarrativeStateError } from '../../domain/errors.js';
import { assertNarrativeTransition, type NarrativeConfiguration, type NarrativeScript, type NarrativeState } from '../../domain/narrative.js';

const now = () => new Date().toISOString();

export class NarrativeRepository {
  constructor(private db: Database.Database) {}

  private opportunity(opportunityId: string) {
    if (!this.db.prepare('SELECT opportunity_id FROM opportunities WHERE opportunity_id=?').get(opportunityId)) throw new NotFoundError();
  }

  createConfiguration(opportunityId: string, configurationId: string, payload: Omit<NarrativeConfiguration, 'configurationId' | 'opportunityId' | 'userApproved' | 'approvedBy' | 'approvedAt'> & { director: string }) {
    this.opportunity(opportunityId);
    const createdAt = now();
    const version = Number((this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM narrative_configurations WHERE opportunity_id=?').get(opportunityId) as any).version) + 1;
    const { director: _director, ...configurationPayload } = payload;
    const stored = { ...configurationPayload, opportunityId, configurationId, userApproved: false };
    this.db.prepare('INSERT INTO narrative_configurations(configuration_id,opportunity_id,version,state,payload,user_approved,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(configurationId, opportunityId, version, 'CONFIGURATION_PENDING_USER_APPROVAL', JSON.stringify(stored), 0, createdAt);
    this.event(opportunityId, 'CONFIGURATION', configurationId, 'PROPOSED', payload.director, undefined, stored);
    return this.getConfiguration(opportunityId, configurationId);
  }

  getConfiguration(opportunityId: string, configurationId?: string) {
    const row = configurationId
      ? this.db.prepare('SELECT * FROM narrative_configurations WHERE opportunity_id=? AND configuration_id=?').get(opportunityId, configurationId)
      : this.db.prepare('SELECT * FROM narrative_configurations WHERE opportunity_id=? ORDER BY version DESC LIMIT 1').get(opportunityId);
    if (!row) throw new NotFoundError('Narrative configuration not found');
    return this.mapConfiguration(row as any);
  }

  approveConfiguration(opportunityId: string, configurationId: string, actor: string) {
    const current = this.getConfiguration(opportunityId, configurationId) as any;
    if (current.state !== 'CONFIGURATION_PENDING_USER_APPROVAL') throw new NarrativeStateError('Only a pending narrative configuration can be approved');
    const approvedAt = now();
    const payload = { ...current.payload, userApproved: true, approvedBy: actor, approvedAt };
    this.db.prepare('UPDATE narrative_configurations SET state=?,payload=?,user_approved=1,approved_by=?,approved_at=? WHERE configuration_id=? AND opportunity_id=?')
      .run('READY_TO_GENERATE', JSON.stringify(payload), actor, approvedAt, configurationId, opportunityId);
    this.event(opportunityId, 'CONFIGURATION', configurationId, 'APPROVED', actor, undefined, payload);
    return this.getConfiguration(opportunityId, configurationId);
  }

  createScript(opportunityId: string, scriptId: string, configurationId: string, payload: Record<string, unknown>, state: NarrativeState, actor: string, reason?: string) {
    if (state !== 'DRAFT' && state !== 'BLOCKED') throw new NarrativeStateError(`Narrative script cannot start in ${state}`);
    this.opportunity(opportunityId);
    const configuration = this.db.prepare('SELECT configuration_id FROM narrative_configurations WHERE opportunity_id=? AND configuration_id=? AND user_approved=1').get(opportunityId, configurationId);
    if (!configuration) throw new NarrativeStateError('An approved narrative configuration is required');
    const createdAt = now();
    const version = Number((this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM narrative_scripts WHERE opportunity_id=?').get(opportunityId) as any).version) + 1;
    const stored = { ...payload, opportunityId, scriptId, configurationId, state, createdAt, ...(reason ? { blockedReason: reason } : {}) };
    this.db.prepare('INSERT INTO narrative_scripts(script_id,opportunity_id,configuration_id,version,state,payload,blocked_reason,blocked_recipient,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(scriptId, opportunityId, configurationId, version, state, JSON.stringify(stored), reason ?? null, state === 'BLOCKED' ? 'DIRECTOR' : null, createdAt);
    this.event(opportunityId, 'SCRIPT', scriptId, state, actor, reason, stored);
    return this.getScript(opportunityId, scriptId);
  }

  getScript(opportunityId: string, scriptId?: string) {
    const row = scriptId
      ? this.db.prepare('SELECT * FROM narrative_scripts WHERE opportunity_id=? AND script_id=?').get(opportunityId, scriptId)
      : this.db.prepare('SELECT * FROM narrative_scripts WHERE opportunity_id=? ORDER BY version DESC LIMIT 1').get(opportunityId);
    if (!row) throw new NotFoundError('Narrative script not found');
    return this.mapScript(row as any);
  }

  setScriptState(opportunityId: string, scriptId: string, state: NarrativeState, actor: string, changes: Record<string, unknown> = {}, reason?: string) {
    const current = this.getScript(opportunityId, scriptId) as any;
    assertNarrativeTransition(current.state, state);
    if (state === 'BLOCKED' && !reason?.trim()) throw new NarrativeStateError('Blocked narratives require a reason');
    if (state === 'DIRECTOR_VALIDATED' && (!changes.directorValidationId || !changes.scriptAuthorization)) {
      throw new NarrativeStateError('Director validation requires persisted authorization');
    }
    const payload = { ...current, ...changes, state, ...(reason ? { blockedReason: reason } : {}) };
    this.db.prepare('UPDATE narrative_scripts SET state=?,payload=?,blocked_reason=?,blocked_recipient=?,director_validation_id=?,script_authorization=? WHERE opportunity_id=? AND script_id=?')
      .run(state, JSON.stringify(payload), reason ?? null, state === 'BLOCKED' ? 'DIRECTOR' : null, payload.directorValidationId ?? null, payload.scriptAuthorization ?? null, opportunityId, scriptId);
    this.event(opportunityId, 'SCRIPT', scriptId, state, actor, reason, payload);
    return this.getScript(opportunityId, scriptId);
  }

  history(opportunityId: string) {
    this.opportunity(opportunityId);
    const configurations = this.db.prepare('SELECT * FROM narrative_configurations WHERE opportunity_id=? ORDER BY version').all(opportunityId).map((r: any) => this.mapConfiguration(r));
    const scripts = this.db.prepare('SELECT * FROM narrative_scripts WHERE opportunity_id=? ORDER BY version').all(opportunityId).map((r: any) => this.mapScript(r));
    const events = this.db.prepare('SELECT * FROM narrative_events WHERE opportunity_id=? ORDER BY id').all(opportunityId);
    return { configurations, scripts, events };
  }

  event(opportunityId: string, artifactType: string, artifactId: string, eventType: string, actor: string, reason?: string, payload?: unknown) {
    this.db.prepare('INSERT INTO narrative_events(opportunity_id,artifact_type,artifact_id,event_type,actor,reason,payload,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(opportunityId, artifactType, artifactId, eventType, actor, reason ?? null, payload ? JSON.stringify(payload) : null, now());
  }

  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }

  private mapConfiguration(row: any) {
    return { ...row, payload: JSON.parse(row.payload), userApproved: Boolean(row.user_approved) };
  }

  private mapScript(row: any): NarrativeScript {
    return JSON.parse(row.payload) as NarrativeScript;
  }
}
