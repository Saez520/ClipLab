import type Database from 'better-sqlite3';
import { NotFoundError } from '../../domain/errors.js';
import type { ContextEntry, SynthesisRequest, SynthesisResult } from '../../domain/synthesis.js';
const now = () => new Date().toISOString();
export type SynthesisSession = { sessionId:string; opportunityId:string; recipient:'DIRECTOR'; createdAt:string; updatedAt:string };
export type SynthesisQuery = { queryId:string; sessionId:string; query:string; context:ContextEntry[]; actor:string; createdAt:string };
export class SynthesisRepository {
 constructor(private db:Database.Database) {}
 createOrGetSession(r:Pick<SynthesisRequest,'sessionId'|'opportunityId'|'recipient'>):SynthesisSession { const x=this.db.prepare('SELECT * FROM synthesis_sessions WHERE session_id=?').get(r.sessionId) as any; if(x&&x.opportunity_id!==r.opportunityId) throw new NotFoundError('Synthesis session not found'); if(!x){const t=now();this.db.prepare('INSERT INTO synthesis_sessions VALUES(?,?,?,?,?)').run(r.sessionId,r.opportunityId,r.recipient,t,t);} return this.getSession(r.sessionId); }
 getSession(id:string):SynthesisSession {const r=this.db.prepare('SELECT * FROM synthesis_sessions WHERE session_id=?').get(id) as any;if(!r)throw new NotFoundError('Synthesis session not found');return {sessionId:r.session_id,opportunityId:r.opportunity_id,recipient:r.recipient,createdAt:r.created_at,updatedAt:r.updated_at};}
 createQuery(r:SynthesisRequest,queryId:string):SynthesisQuery {const t=now();this.db.prepare('INSERT INTO synthesis_queries VALUES(?,?,?,?,?,?)').run(queryId,r.sessionId,r.query,JSON.stringify(r.context),r.actor,t);this.db.prepare('UPDATE synthesis_sessions SET updated_at=? WHERE session_id=?').run(t,r.sessionId);return {queryId,sessionId:r.sessionId,query:r.query,context:r.context,actor:r.actor,createdAt:t};}
 getQuery(id:string):SynthesisQuery {const r=this.db.prepare('SELECT * FROM synthesis_queries WHERE query_id=?').get(id) as any;if(!r)throw new NotFoundError('Synthesis query not found');return {queryId:r.query_id,sessionId:r.session_id,query:r.query,context:JSON.parse(r.context),actor:r.actor,createdAt:r.created_at};}
 saveResult(id:string,result:SynthesisResult):SynthesisResult {this.getQuery(id);const v=(this.db.prepare('SELECT COALESCE(MAX(version),0)+1 v FROM synthesis_results WHERE query_id=?').get(id) as any).v;this.db.prepare('INSERT INTO synthesis_results(query_id,version,result,created_at) VALUES(?,?,?,?)').run(id,v,JSON.stringify(result),now());return result;}
 getResult(id:string):SynthesisResult {this.getQuery(id);const r=this.db.prepare('SELECT result FROM synthesis_results WHERE query_id=? ORDER BY version DESC LIMIT 1').get(id) as any;if(!r)throw new NotFoundError('Synthesis result not found');return JSON.parse(r.result);}
 transaction<T>(fn:()=>T):T{return this.db.transaction(fn)();}
}
