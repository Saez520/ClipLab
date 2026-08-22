import type Database from 'better-sqlite3'; import type { PipelineState, VisibleState, Role } from '../../domain/pipeline.js'; import type { HandoffPayload } from '../../domain/handoffs.js'; import { BlockedPipelineError, NotFoundError } from '../../domain/errors.js';
export type Opportunity = { opportunityId:string; state:VisibleState; stableState:PipelineState; blockedReason?:string; blockedActor?:string; createdAt:string; updatedAt:string };
export type Event = { eventType:string; fromState?:string; toState?:string; actor:string; reason?:string; payload?:unknown; createdAt:string };
const now=()=>new Date().toISOString();
export class PipelineRepository {
 constructor(private db:Database.Database) {}
 create(id:string){const t=now(); this.db.prepare('INSERT INTO opportunities VALUES (?, ?, ?, NULL, NULL, ?, ?)').run(id,'NOTE','NOTE',t,t); this.event(id,'CREATED','NOTE',undefined,'system');}
 get(id:string):Opportunity { const r=this.db.prepare('SELECT * FROM opportunities WHERE opportunity_id=?').get(id) as any; if(!r) throw new NotFoundError(); return {opportunityId:r.opportunity_id,state:r.state,stableState:r.stable_state,blockedReason:r.blocked_reason,blockedActor:r.blocked_actor,createdAt:r.created_at,updatedAt:r.updated_at}; }
  authorize(id:string, fromState:PipelineState, role:Role, actor:string){ this.get(id); const result=this.db.prepare('INSERT INTO authorizations(opportunity_id,from_state,role,actor,created_at) VALUES (?,?,?,?,?)').run(id,fromState,role,actor,now()); return Number(result.lastInsertRowid); }
  hasEditorialProposal(id:string){ return Boolean(this.db.prepare("SELECT 1 FROM editorial_decisions WHERE opportunity_id=? AND status='PROPOSED' LIMIT 1").get(id)); }
 authorization(id:string, state:string, role:string){return this.db.prepare('SELECT * FROM authorizations WHERE opportunity_id=? AND from_state=? AND role=? AND consumed=0 ORDER BY id DESC LIMIT 1').get(id,state,role) as any;}
 consumeAuthorization(id:number){this.db.prepare('UPDATE authorizations SET consumed=1 WHERE id=?').run(id);}
 advance(id:string, from:PipelineState, to:PipelineState, payload:HandoffPayload, actor:string){const t=now(); this.db.prepare('UPDATE opportunities SET state=?,stable_state=?,blocked_reason=NULL,blocked_actor=NULL,updated_at=? WHERE opportunity_id=?').run(to,to,t,id); this.db.prepare('INSERT INTO handoffs(opportunity_id,from_state,to_state,payload,created_at) VALUES(?,?,?,?,?)').run(id,from,to,JSON.stringify(payload),t); this.event(id,'ADVANCED',from,to,actor,undefined,payload);}
 block(id:string, reason:string, actor:string){const o=this.get(id); const t=now(); this.db.prepare("UPDATE opportunities SET state='BLOCKED',blocked_reason=?,blocked_actor=?,updated_at=? WHERE opportunity_id=?").run(reason,actor,t,id); this.event(id,'BLOCKED',o.state,undefined,actor,reason);}
  returnToOwnStage(id:string, actor:string, reason:string){const o=this.get(id); if(o.state==='BLOCKED') throw new BlockedPipelineError('Blocked pipeline cannot be returned directly'); const t=now(); this.db.prepare('UPDATE opportunities SET state=stable_state,updated_at=? WHERE opportunity_id=?').run(t,id); this.event(id,'RETURNED',o.state,o.stableState,actor,reason);}
 event(id:string,type:string,from:string|undefined,to:string|undefined,actor:string,reason?:string,payload?:unknown){this.db.prepare('INSERT INTO events(opportunity_id,event_type,from_state,to_state,actor,reason,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,type,from,to,actor,reason,payload?JSON.stringify(payload):null,now());}
 lineage(id:string){const o=this.get(id); const handoffs=this.db.prepare('SELECT * FROM handoffs WHERE opportunity_id=? ORDER BY id').all(id).map((r:any)=>({...r,payload:JSON.parse(r.payload)})); const events=this.db.prepare('SELECT * FROM events WHERE opportunity_id=? ORDER BY id').all(id); return {...o,handoffs,events};}
 transaction<T>(fn:()=>T):T { return this.db.transaction(fn)(); }
 close(){this.db.close();}
}
