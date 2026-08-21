import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { synthesisRequestSchema, synthesisResultSchema, projectSynthesisToHandoff, type SynthesisRequest, type SynthesisResult } from '../domain/synthesis.js';
import { ValidationError } from '../domain/errors.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { SynthesisRepository } from '../infrastructure/repositories/synthesis-repository.js';

const startSessionSchema = synthesisRequestSchema.omit({ query: true, context: true });
const saveResultSchema = synthesisResultSchema.extend({ sessionId: z.string().min(1) });

export class SynthesisService {
  constructor(private repo: SynthesisRepository, private pipeline: PipelineRepository) {}

  startSession(input: unknown) {
    const result = startSessionSchema.parse(input);
    this.pipeline.get(result.opportunityId);
    return this.repo.createOrGetSession(result);
  }

  delegate(input: unknown) {
    const result = synthesisRequestSchema.parse(input);
    this.pipeline.get(result.opportunityId);
    const session = this.repo.createOrGetSession(result);
    const query = this.repo.createQuery(result, randomUUID());
    return { ...query, session };
  }

  saveResult(queryId: string, opportunityId: string, input: unknown): SynthesisResult {
    const request = saveResultSchema.parse({ ...(input as object), queryId });
    const query = this.repo.getQuery(queryId);
    const session = this.repo.getSession(query.sessionId);
    if (session.sessionId !== request.sessionId || session.opportunityId !== opportunityId) {
      throw new ValidationError('Synthesis session does not match request');
    }
    const { sessionId: _sessionId, ...result } = request;
    return this.repo.saveResult(queryId, result);
  }

  getResult(queryId: string, sessionId: string, opportunityId: string): SynthesisResult {
    const query = this.repo.getQuery(queryId);
    const session = this.repo.getSession(query.sessionId);
    if (session.sessionId !== sessionId || session.opportunityId !== opportunityId) {
      throw new ValidationError('Synthesis session does not match request');
    }
    return this.repo.getResult(queryId);
  }

  handoff(queryId: string, sessionId: string, opportunityId: string) {
    return projectSynthesisToHandoff(this.getResult(queryId, sessionId, opportunityId));
  }
}
