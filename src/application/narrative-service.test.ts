import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../infrastructure/db/database.js';
import { CurationRepository } from '../infrastructure/repositories/curation-repository.js';
import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { CurationService } from './curation-service.js';
import { NarrativeService } from './narrative-service.js';
import { PipelineService } from './pipeline-service.js';

let db: any;
afterEach(() => db?.close());

function setup() {
  db = openDatabase(':memory:');
  const pipeline = new PipelineRepository(db);
  pipeline.create('o');
  const curation = new CurationService(new CurationRepository(db), pipeline);
  const proposal = curation.propose('o', { originalNote: 'n', evidence: 'e', centralApproach: 'a', audience: 'BOTH', objective: 'DISCOVERY' });
  curation.approve('o', proposal.proposal_id, { actor: 'user' });
  pipeline.advance('o', 'NOTE', 'SCRIPT', { opportunityId: 'o', originalNote: 'n', directorDecision: 'APPROVE', centralApproach: 'a' }, 'director');
  const narrativeRepository = new NarrativeRepository(db);
  return {
    service: new NarrativeService(narrativeRepository, new CurationRepository(db), pipeline),
    pipeline,
    pipelineService: new PipelineService(pipeline, narrativeRepository)
  };
}

describe('narrative service', () => {
  it('requires both approvals and emits a clean storyboard handoff', () => {
    const { service, pipeline, pipelineService } = setup();
    const config = service.proposeConfiguration('o', { audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous', targetDurationSeconds: 45 });
    expect(() => service.generate('o', { narrativeText: 'Texto' })).toThrow();
    service.approveConfiguration('o', config.configuration_id, { actor: 'user' });
    const script = service.generate('o', { narrativeText: 'Texto [src/example.ts:1]', sources: { 'src/example.ts': 'line' } });
    expect(script.state).toBe('READY_FOR_DIRECTOR_VALIDATION');
    service.validateDirector('o', { actor: 'director', role: 'DIRECTOR' });
    const handoff: any = service.handoff('o');
    expect(handoff).toMatchObject({ opportunityId: 'o', authorizedScript: 'Texto [src/example.ts:1]' });
    expect(handoff).not.toHaveProperty('preciseConcepts');
    pipelineService.advance('o', 'writer', 'WRITER', handoff);
    expect(pipeline.get('o').state).toBe('STORYBOARD');
  });

  it('uses explicit actor from input when provided', () => {
    const { service } = setup();
    const config = service.proposeConfiguration('o', { audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous', targetDurationSeconds: 45 });
    service.approveConfiguration('o', config.configuration_id, { actor: 'user' });
    const script = service.generate('o', { narrativeText: 'Texto [src/example.ts:1]', sources: { 'src/example.ts': 'line' }, actor: 'director' });
    expect(script.state).toBe('READY_FOR_DIRECTOR_VALIDATION');
    const lineage: any = service.lineage('o');
    const lastEvent = lineage.narrative.events[lineage.narrative.events.length - 1];
    expect(lastEvent.actor).toBe('director');
  });

  it('blocks material gaps without authorizing the storyboard', () => {
    const { service, pipeline } = setup();
    const config = service.proposeConfiguration('o', { audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'continuous' });
    service.approveConfiguration('o', config.configuration_id, { actor: 'user' });
    expect(() => service.generate('o', { narrativeText: 'Parcial', materialGap: 'Falta el dato central' })).toThrow('blocked');
    expect(service.getScript('o').state).toBe('BLOCKED');
    expect(() => service.handoff('o')).toThrow();
    expect(pipeline.get('o').state).toBe('SCRIPT');
  });
});
