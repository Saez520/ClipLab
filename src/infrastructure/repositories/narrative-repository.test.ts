import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { PipelineRepository } from './pipeline-repository.js';
import { NarrativeRepository } from './narrative-repository.js';

let db: any;
afterEach(() => db?.close());

describe('narrative repository', () => {
  it('keeps configuration, script and transition history', () => {
    db = openDatabase(':memory:');
    new PipelineRepository(db).create('o');
    const repo = new NarrativeRepository(db);
    const config = repo.createConfiguration('o', 'c1', { audience: 'a', tone: 't', depth: 'd', voice: 'v', style: 's', director: 'director' });
    expect(config.state).toBe('CONFIGURATION_PENDING_USER_APPROVAL');
    repo.approveConfiguration('o', 'c1', 'user');
    repo.createScript('o', 's1', 'c1', { narrativeText: 'Texto', references: [] }, 'DRAFT', 'narrator');
    repo.setScriptState('o', 's1', 'READY_FOR_DIRECTOR_VALIDATION', 'narrator');
    expect(repo.history('o').configurations).toHaveLength(1);
    expect(repo.history('o').scripts).toHaveLength(1);
    expect(repo.history('o').events).toHaveLength(4);
  });

  it('does not approve a configuration twice', () => {
    db = openDatabase(':memory:');
    new PipelineRepository(db).create('o');
    const repo = new NarrativeRepository(db);
    repo.createConfiguration('o', 'c1', { audience: 'a', tone: 't', depth: 'd', voice: 'v', style: 's', director: 'director' });
    repo.approveConfiguration('o', 'c1', 'user');
    expect(() => repo.approveConfiguration('o', 'c1', 'user')).toThrow();
  });

  it('rejects illegal script state transitions', () => {
    db = openDatabase(':memory:');
    new PipelineRepository(db).create('o');
    const repo = new NarrativeRepository(db);
    repo.createConfiguration('o', 'c1', { audience: 'a', tone: 't', depth: 'd', voice: 'v', style: 's', director: 'director' });
    repo.approveConfiguration('o', 'c1', 'user');
    repo.createScript('o', 's1', 'c1', { narrativeText: 'Texto', references: [] }, 'DRAFT', 'narrator');

    expect(() => repo.setScriptState('o', 's1', 'DIRECTOR_VALIDATED', 'director', {
      directorValidationId: 'validation',
      scriptAuthorization: 'authorization'
    })).toThrow('not allowed');

    repo.setScriptState('o', 's1', 'BLOCKED', 'director', {}, 'Falta información material');
    expect(() => repo.setScriptState('o', 's1', 'READY_FOR_DIRECTOR_VALIDATION', 'director')).toThrow('not allowed');
  });
});
