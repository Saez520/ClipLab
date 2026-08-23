import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { PipelineRepository } from './pipeline-repository.js';
import { StoryboardRepository } from './storyboard-repository.js';

let db: any;
afterEach(() => db?.close());

const revision = {
  opportunityId: 'o', storyboardId: 'o-storyboard', storyboardRevisionId: 'o-revision-1', version: 1,
  state: 'STORYBOARD_READY_FOR_USER_APPROVAL' as const, scriptId: 'script', directorValidationId: 'validation', scriptAuthorization: 'authorization',
  profile: { platform: 'generic', aspectRatio: '9:16', language: 'español', visualDensity: 'standard' as const }, finalDurationSeconds: 30,
  segments: [{ segmentId: 's1', version: 1, narrativeSpan: 'span', narrativeStart: 0, narrativeEnd: 4, durationSeconds: 30, position: 0, audio: 'audio', visualRepresentation: 'diagram', audiovisualMapping: { narrativeMeaning: 'meaning', audio: 'audio', visual: 'diagram', correspondence: 'mapped' }, rhythm: 'steady', synchronization: 'sync', sourceReferences: [{ path: 'source.md', locator: '1', summary: 'summary', segmentId: 's1' }], technicalConditions: [], technicalCoverage: [], dependsOn: [], validation: { supportsNarrative: true, preservesTechnicalConditions: true, introducesUnsupportedClaims: false, usesAudioAsSubtitlesOnly: false, editorialChange: false, reasons: [], requiredConditionIds: [], coveredConditionIds: [], missingConditionIds: [], unknownConditionIds: [], duplicateConditionIds: [], contradictoryConditionIds: [], ambiguousConditionExpressions: [] } }],
  sources: [{ path: 'source.md', locator: '1', summary: 'summary', segmentId: 's1' }], validations: [{ supportsNarrative: true, preservesTechnicalConditions: true, introducesUnsupportedClaims: false, usesAudioAsSubtitlesOnly: false, editorialChange: false, reasons: [], requiredConditionIds: [], coveredConditionIds: [], missingConditionIds: [], unknownConditionIds: [], duplicateConditionIds: [], contradictoryConditionIds: [], ambiguousConditionExpressions: [] }], corrections: []
};

describe('storyboard repository', () => {
  it('persists revisions, segments, sources, validations and lineage atomically', () => {
    db = openDatabase(':memory:');
    new PipelineRepository(db).create('o');
    const repo = new StoryboardRepository(db);
    repo.createRevision(revision, 'storyboard');
    expect(repo.getRevision('o').storyboardRevisionId).toBe('o-revision-1');
    expect(repo.history('o')).toMatchObject({ revisions: [expect.objectContaining({ version: 1 })] });
    expect(repo.history('o').events).toHaveLength(1);
  });

  it('does not leave partial rows when revision validation fails', () => {
    db = openDatabase(':memory:');
    new PipelineRepository(db).create('o');
    const repo = new StoryboardRepository(db);
    expect(() => repo.createRevision({ ...revision, segments: [] }, 'storyboard')).toThrow();
    expect(() => repo.get('o')).toThrow();
  });

  it('rejects superseding a revision through an undeclared state transition', () => {
    db = openDatabase(':memory:');
    new PipelineRepository(db).create('o');
    const repo = new StoryboardRepository(db);
    repo.createRevision(revision, 'storyboard');

    expect(() => repo.markSuperseded('o', revision.storyboardRevisionId, 'storyboard')).toThrow(/not allowed/);
    expect(repo.getRevision('o').state).toBe('STORYBOARD_READY_FOR_USER_APPROVAL');
  });
});
