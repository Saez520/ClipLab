import { describe, expect, it } from 'vitest';
import { projectSynthesisToHandoff, synthesisRequestSchema, synthesisResultSchema } from './synthesis.js';

describe('synthesis contracts', () => {
  it('accepts a complete result and projects it to the note handoff', () => {
    const result = synthesisResultSchema.parse({ queryId: 'q1', conclusion: 'C', relevantEvidence: ['E'], uncertainties: ['U'], recommendation: 'R', sources: [{ title: 'Spec', locator: 'https://example.test', authority: 'PRIMARY' }] });
    expect(projectSynthesisToHandoff(result)).toEqual({ relevantSynthesis: 'C\nR\nE', sourcesToPreserve: ['Spec: https://example.test'], acceptedGaps: ['U'] });
  });
  it('rejects an unknown field and a non-authorized recipient', () => {
    expect(() => synthesisRequestSchema.parse({ opportunityId: 'o', sessionId: 's', actor: 'a', recipient: 'WRITER', query: 'q' })).toThrow();
    expect(() => synthesisResultSchema.parse({ queryId: 'q', conclusion: 'C', relevantEvidence: [], uncertainties: [], recommendation: 'R', invented: true })).toThrow();
  });
});
