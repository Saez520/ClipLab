import type Database from 'better-sqlite3';
import { NotFoundError } from '../../domain/errors.js';
const now = () => new Date().toISOString();
export class CurationRepository {
  constructor(private db: Database.Database) {}
  createProposal(opportunityId: string, proposalId: string, proposal: unknown, result: string, director: string, criteria: unknown) { const t=now(); this.db.prepare('SELECT opportunity_id FROM opportunities WHERE opportunity_id=?').get(opportunityId) || (()=>{throw new NotFoundError();})(); this.db.prepare('INSERT INTO editorial_decisions VALUES(?,?,?,?,?,?,?,?,?)').run(proposalId,opportunityId,JSON.stringify(criteria),result,JSON.stringify(proposal),director,'PROPOSED',t,t); return this.getProposal(opportunityId, proposalId); }
  getProposal(opportunityId:string, proposalId:string) { const r=this.db.prepare('SELECT * FROM editorial_decisions WHERE opportunity_id=? AND proposal_id=?').get(opportunityId,proposalId) as any; if(!r) throw new NotFoundError('Editorial proposal not found'); return this.map(r); }
  latest(opportunityId:string) { const r=this.db.prepare('SELECT * FROM editorial_decisions WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1').get(opportunityId) as any; if(!r) throw new NotFoundError('Editorial proposal not found'); return this.map(r); }
  hasApprovedProposal(opportunityId:string) { return Boolean(this.db.prepare("SELECT 1 FROM editorial_decisions WHERE opportunity_id=? AND status='APPROVED' LIMIT 1").get(opportunityId)); }
  responses(proposalId:string) { return this.db.prepare('SELECT * FROM editorial_responses WHERE proposal_id=? ORDER BY id').all(proposalId); }
  respond(opportunityId:string, proposalId:string, status:'APPROVED'|'QUESTIONED', actor:string, reason?:string, authorizationId?:number) { this.getProposal(opportunityId,proposalId); const t=now(); this.db.prepare('INSERT INTO editorial_responses(proposal_id,opportunity_id,status,actor,reason,authorization_id,created_at) VALUES(?,?,?,?,?,?,?)').run(proposalId,opportunityId,status,actor,reason??null,authorizationId??null,t); this.db.prepare('UPDATE editorial_decisions SET status=?,updated_at=? WHERE proposal_id=?').run(status, t, proposalId); return this.getProposal(opportunityId,proposalId); }
  setAuthorization(proposalId:string, authorizationId:number) { this.db.prepare('UPDATE editorial_responses SET authorization_id=? WHERE id=(SELECT id FROM editorial_responses WHERE proposal_id=? ORDER BY id DESC LIMIT 1)').run(authorizationId,proposalId); }
  addWarning(proposalId:string, warning:string) { const r=this.db.prepare('SELECT proposal FROM editorial_decisions WHERE proposal_id=?').get(proposalId) as any; if(!r) throw new NotFoundError('Editorial proposal not found'); const proposal=JSON.parse(r.proposal); proposal.warnings=[...(proposal.warnings??[]),warning]; this.db.prepare('UPDATE editorial_decisions SET proposal=?,updated_at=? WHERE proposal_id=?').run(JSON.stringify(proposal),now(),proposalId); }
  private map(r:any) { return {...r, criteria:JSON.parse(r.criteria), proposal:JSON.parse(r.proposal), responses:this.responses(r.proposal_id)}; }
  transaction<T>(fn:()=>T):T { return this.db.transaction(fn)(); }
}
