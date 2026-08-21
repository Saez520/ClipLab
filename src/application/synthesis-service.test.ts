import { describe, expect, it } from 'vitest';
import { openDatabase } from '../infrastructure/db/database.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { SynthesisRepository } from '../infrastructure/repositories/synthesis-repository.js';
import { SynthesisService } from './synthesis-service.js';
describe('SynthesisService', () => {
  it('keeps continuity and projects a validated result', () => {
    const db = openDatabase(':memory:');
    const pipeline = new PipelineRepository(db);
    pipeline.create('o');
    const service = new SynthesisService(new SynthesisRepository(db), pipeline);
    service.startSession({ opportunityId: 'o', sessionId: 'task-1', actor: 'director', recipient: 'DIRECTOR' });
    const query = service.delegate({ opportunityId: 'o', sessionId: 'task-1', actor: 'director', recipient: 'DIRECTOR', query: 'find context', context: [] });
    service.saveResult(query.queryId, 'o', { sessionId: 'task-1', conclusion: 'enough', relevantEvidence: [], uncertainties: [], recommendation: 'proceed' });
    expect(service.handoff(query.queryId, 'task-1', 'o')).toEqual({ relevantSynthesis: 'enough\nproceed', sourcesToPreserve: [], acceptedGaps: [] });
  });

  it('rejects non-director recipients', () => {
    const db = openDatabase(':memory:');
    const pipeline = new PipelineRepository(db);
    pipeline.create('o');
    const service = new SynthesisService(new SynthesisRepository(db), pipeline);
    expect(() => service.delegate({ opportunityId: 'o', sessionId: 's', actor: 'a', recipient: 'WRITER', query: 'q', context: [] })).toThrow();
  });
});
