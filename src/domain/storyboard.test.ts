import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { storyboardToRenderSchema } from './handoffs.js';
import { finalDuration, normalizePublicationProfile, storyboardSegmentSchema } from './storyboard.js';

const segment = {
  segmentId: 'segment-1',
  narrativeSpan: 'La explicación principal',
  narrativeStart: 0,
  narrativeEnd: 'La explicación principal'.length,
  durationSeconds: 30,
  position: 0,
  audio: 'La explicación principal',
  visualRepresentation: 'Diagrama de flujo con tres etapas',
  audiovisualMapping: { narrativeMeaning: 'Explicación', audio: 'Narración', visual: 'Diagrama', correspondence: 'Cada etapa corresponde al audio' },
  rhythm: 'standard',
  synchronization: 'visual enters with narration',
  sourceReferences: [{ path: 'source.md', locator: '1', summary: 'Fuente resuelta', segmentId: 'segment-1' }],
  technicalConditions: [],
  technicalCoverage: [],
  dependsOn: [],
  validation: { supportsNarrative: true, preservesTechnicalConditions: true, introducesUnsupportedClaims: false, usesAudioAsSubtitlesOnly: false, editorialChange: false, reasons: [] }
};

describe('storyboard contracts', () => {
  it('applies the closed publication defaults and computes duration', () => {
    expect(normalizePublicationProfile({})).toMatchObject({ aspectRatio: '9:16', language: 'español', visualDensity: 'standard' });
    expect(finalDuration([segment, { ...segment, segmentId: 'segment-2', position: 1, durationSeconds: 15, sourceReferences: [{ ...segment.sourceReferences[0], segmentId: 'segment-2' }] }])).toBe(45);
  });

  it('accepts a valid dual-channel segment', () => {
    expect(storyboardSegmentSchema.parse(segment).segmentId).toBe('segment-1');
  });

  it('rejects audio-only subtitles and incomplete segments', () => {
    expect(() => storyboardSegmentSchema.parse({ ...segment, visualRepresentation: segment.audio })).toThrow(ZodError);
    expect(() => storyboardSegmentSchema.parse({ ...segment, synchronization: undefined })).toThrow(ZodError);
  });

  it('rejects incomplete render handoffs', () => {
    expect(() => storyboardToRenderSchema.parse({ opportunityId: 'o' })).toThrow(ZodError);
  });
});
