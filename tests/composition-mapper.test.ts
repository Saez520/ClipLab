import { describe, expect, it } from 'vitest';
import { classifySegment, mapSegmentToSlots, truncateWords, truncateChars, accentWord } from '../src/infrastructure/render/composition-mapper.js';
import type { StoryboardSegment } from '../src/domain/storyboard.js';

const baseSegment = (visualRepresentation: string, overrides: Partial<StoryboardSegment> = {}): StoryboardSegment => ({
  segmentId: 'seg-1',
  version: 1,
  narrativeSpan: 'span seg-1',
  narrativeStart: 0,
  narrativeEnd: 10,
  durationSeconds: 30,
  position: 0,
  audio: 'audio seg-1',
  visualRepresentation,
  audiovisualMapping: {
    narrativeMeaning: overrides.audiovisualMapping?.narrativeMeaning ?? 'significado',
    audio: 'audio seg-1',
    visual: visualRepresentation,
    correspondence: overrides.audiovisualMapping?.correspondence ?? 'correspondence'
  },
  rhythm: 'steady',
  synchronization: 'sync',
  sourceReferences: [{ path: 'source.md', locator: '1', content: 'content', summary: 'content', segmentId: 'seg-1' }],
  technicalConditions: [],
  technicalCoverage: [],
  dependsOn: [],
  validation: {
    supportsNarrative: true,
    preservesTechnicalConditions: true,
    introducesUnsupportedClaims: false,
    usesAudioAsSubtitlesOnly: false,
    editorialChange: false,
    reasons: [],
    requiredConditionIds: [],
    coveredConditionIds: [],
    missingConditionIds: [],
    unknownConditionIds: [],
    duplicateConditionIds: [],
    contradictoryConditionIds: [],
    ambiguousConditionExpressions: []
  },
  ...overrides
} as StoryboardSegment);

describe('composition-mapper: classifySegment', () => {
  it('classifies transformation with arrow marker and correspondence', () => {
    const segment = baseSegment('entrada X → salida Y', { audiovisualMapping: { narrativeMeaning: 'transformación', audio: 'a', visual: 'v', correspondence: 'transformación' } });
    const slots = mapSegmentToSlots(segment);
    expect(slots.criterion).toBe('transformation');
    expect(slots.slots['content.entrada']).toBe('entrada X');
    expect(slots.slots['content.salida']).toBe('salida Y');
  });

  it('classifies relation with 2+ lateral items', () => {
    const segment = baseSegment('El núcleo central se relaciona con Alfa y Beta', { audiovisualMapping: { narrativeMeaning: 'relación', audio: 'a', visual: 'v', correspondence: 'relación' } });
    const slots = mapSegmentToSlots(segment);
    expect(slots.criterion).toBe('relation');
    expect(slots.slots['content.centerTitle']).toBe('El núcleo central');
    expect(slots.slots['content.sideLeft']).toBe('Alfa');
    expect(slots.slots['content.sideRight']).toBe('Beta');
  });

  it('falls back to fallback when relation lacks 2 laterals', () => {
    const segment = baseSegment('X se relaciona con Alfa', { audiovisualMapping: { narrativeMeaning: 'relación', audio: 'a', visual: 'v', correspondence: 'relación' } });
    expect(classifySegment(segment)).toBe('fallback');
  });

  it('classifies sequence with numbered steps', () => {
    const segment = baseSegment('1) preparar la mezcla 2) servir la muestra 3) medir resultado', { audiovisualMapping: { narrativeMeaning: 'secuencia', audio: 'a', visual: 'v', correspondence: 'secuencia' } });
    const slots = mapSegmentToSlots(segment);
    expect(slots.criterion).toBe('sequence');
    expect(slots.slots['content.steps']).toContain('01');
    expect(slots.slots['content.steps']).toContain('03');
  });

  it('falls back when sequence has fewer than 2 steps', () => {
    const segment = baseSegment('1) solo un paso', { audiovisualMapping: { narrativeMeaning: 'secuencia', audio: 'a', visual: 'v', correspondence: 'secuencia' } });
    expect(classifySegment(segment)).toBe('fallback');
  });

  it('classifies hero with single acronym and emits content.letters HTML', () => {
    const segment = baseSegment('La API (Interfaz de Programación de Aplicaciones) conecta todo', { audiovisualMapping: { narrativeMeaning: 'hero', audio: 'a', visual: 'v', correspondence: 'hero' } });
    const slots = mapSegmentToSlots(segment);
    expect(slots.criterion).toBe('hero');
    // content.letters now carries the .letter HTML (not content.char/content.label).
    expect(slots.slots['content.letters']).toContain('class="letter__char"');
    expect(slots.slots['content.letters']).toContain('API');
    expect(slots.slots['content.letters']).toContain('class="letter__label"');
    expect(slots.slots['content.letters']).toContain('Interfaz de Programación de Aplicaciones');
    // Badge uniform across criteria.
    expect(slots.slots['content.badge']).toBe('hero');
  });

  it('classifies chaos with problem + solution terms', () => {
    const segment = baseSegment('items fragmentados; desorden y caos hasta la solución ordenada', { audiovisualMapping: { narrativeMeaning: 'caos', audio: 'a', visual: 'v', correspondence: 'caos' } });
    const slots = mapSegmentToSlots(segment);
    expect(slots.criterion).toBe('chaos');
    expect(slots.slots['content.chips']).toContain('&times;');
  });

  it('falls back to fallback for plain text', () => {
    const segment = baseSegment('Texto simple', { audiovisualMapping: { narrativeMeaning: 'intro', audio: 'a', visual: 'v', correspondence: 'intro' } });
    const slots = mapSegmentToSlots(segment);
    expect(slots.criterion).toBe('fallback');
    expect(slots.slots['content.heading']).toBeTruthy();
    expect(slots.slots['content.badge']).toBeTruthy();
  });

  it('applies precedence: transformation wins over sequence (arrow + enumeration)', () => {
    const segment = baseSegment('A → B 1) paso uno 2) paso dos', { audiovisualMapping: { narrativeMeaning: 'transformación secuencia', audio: 'a', visual: 'v', correspondence: 'transformación' } });
    expect(classifySegment(segment)).toBe('transformation');
  });

  it('escapes hostile content in slots', () => {
    const segment = baseSegment('a <script>alert(1)</script> → b', { audiovisualMapping: { narrativeMeaning: 'transformación', audio: 'a', visual: 'v', correspondence: 'transformación' } });
    const slots = mapSegmentToSlots(segment);
    expect(slots.slots['content.entrada']).toBe('a &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(slots.slots['content.salida']).toBe('b');
  });

  it('always exhausts to fallback (never returns null criterion)', () => {
    for (const vr of ['', 'x', '123', '?!@#$%^&*()']) {
      const segment = baseSegment(vr || 'texto', { audiovisualMapping: { narrativeMeaning: 'm', audio: 'a', visual: 'v', correspondence: 'c' } });
      expect(classifySegment(segment)).toBe('fallback');
    }
  });
});

describe('composition-mapper: truncate helpers', () => {
  it('truncateWords cuts at maxWords with ellipsis', () => {
    expect(truncateWords('uno dos tres cuatro', 3, 100)).toBe('uno dos tres…');
  });

  it('truncateWords cuts at maxChars when words fit but chars exceed', () => {
    expect(truncateWords('abcdefghij klmnopqrst', 5, 15)).toContain('…');
  });

  it('truncateChars cuts with ellipsis (result ≤ maxChars)', () => {
    const result = truncateChars('abcdefghijklmnop', 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('abcdefghi')).toBe(true);
  });

  it('accentWord finds first long non-stopword', () => {
    expect(accentWord('El framework robusto maneja todo')).toBe('framework');
  });

  it('accentWord returns null when no candidate', () => {
    expect(accentWord('el la los')).toBeNull();
  });
});
