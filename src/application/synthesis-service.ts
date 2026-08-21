import { randomUUID } from 'node:crypto';
import { synthesisRequestSchema, synthesisResultSchema, projectSynthesisToHandoff, type SynthesisRequest, type SynthesisResult } from '../domain/synthesis.js';
import { ValidationError } from '../domain/errors.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { SynthesisRepository } from '../infrastructure/repositories/synthesis-repository.js';

export class SynthesisService {
  constructor(private repo:SynthesisRepository, private pipeline:PipelineRepository) {}
  startSession(input:unknown) { const r=synthesisRequestSchema.parse(Object.assign({}, input, {query:'session initialization', context:[]})); this.pipeline.get(r.opportunityId); return this.repo.createOrGetSession(r); }
  delegate(input:unknown) { const r=synthesisRequestSchema.parse(input); this.pipeline.get(r.opportunityId); const session=this.repo.createOrGetSession(r); const query=this.repo.createQuery(r,randomUUID()); return {...query, session}; }
  saveResult(queryId:string, input:unknown):SynthesisResult { const result=synthesisResultSchema.parse(Object.assign({}, input, {queryId})); return this.repo.saveResult(queryId,result); }
  getResult(queryId:string, sessionId:string, opportunityId:string):SynthesisResult { const query=this.repo.getQuery(queryId); const session=this.repo.getSession(query.sessionId); if(session.sessionId!==sessionId||session.opportunityId!==opportunityId) throw new ValidationError('Synthesis session does not match request'); return this.repo.getResult(queryId); }
  handoff(queryId:string, sessionId:string, opportunityId:string) { return projectSynthesisToHandoff(this.getResult(queryId,sessionId,opportunityId)); }
}
