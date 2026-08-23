import { describe, expect, it } from 'vitest';
import { compareTechnicalConditions, extractTechnicalConditions, technicalConditionKey } from './technical-conditions.js';

describe('technical condition grammar', () => {
  it('extracts bounded resolution, frame rate, refresh rate, aspect ratio and display modes', () => {
    const result = extractTechnicalConditions({ path: 'source.md', locator: '1', content: '1080p at 60 fps, 120 Hz, 16:9, VR and 3D' });
    expect(result.state).toBe('COMPLETE');
    expect(result.conditions.map(condition => condition.type)).toEqual(['resolution', 'frameRate', 'refreshRate', 'aspectRatio', 'displayMode', 'displayMode']);
    expect(result.conditions[0].canonicalValue).toEqual({ value: 1080, unit: 'p' });
  });

  it('does not use substring matching', () => {
    expect(extractTechnicalConditions('foo1080pbar 60fpsx').conditions).toEqual([]);
  });

  it('canonicalizes aliases and creates stable IDs', () => {
    const first = extractTechnicalConditions({ path: 'source.md', locator: '1', content: 'FULL HD 60FPS' });
    const second = extractTechnicalConditions({ path: 'source.md', locator: '1', content: 'FULL HD 60FPS' });
    expect(first.conditions.map(condition => technicalConditionKey(condition))).toEqual(['resolution:{"value":1080,"unit":"p"}', 'frameRate:{"value":60,"unit":"fps"}']);
    expect(first.conditions.map(condition => condition.conditionId)).toEqual(second.conditions.map(condition => condition.conditionId));
  });

  it('marks ambiguous expressions instead of treating them as an empty complete inventory', () => {
    expect(extractTechnicalConditions('4K master').state).toBe('AMBIGUOUS');
    expect(extractTechnicalConditions('30–60 fps').state).toBe('AMBIGUOUS');
  });

  it('detects missing, unknown and duplicate coverage', () => {
    const required = extractTechnicalConditions({ path: 'source.md', locator: '1', content: '1080p' }).conditions;
    expect(compareTechnicalConditions(required, [])).toMatchObject({ missingIds: [required[0].conditionId] });
    expect(compareTechnicalConditions(required, ['unknown'])).toMatchObject({ unknownIds: ['unknown'] });
    expect(compareTechnicalConditions(required, [required[0].conditionId, required[0].conditionId])).toMatchObject({ duplicateIds: [required[0].conditionId] });
  });
});
