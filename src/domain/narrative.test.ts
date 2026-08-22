import { describe, expect, it } from 'vitest';
import { durationText, locutionText, narrativeConfigurationSchema, parseInlineReferences, subtitleText } from './narrative.js';

describe('narrative contracts', () => {
  const sources = { 'src/example.ts': 'one\ntwo\nthree', 'docs/example.md': '# Introducción\ntexto' };

  it('requires user approval and accepts resolvable inline references', () => {
    expect(() => narrativeConfigurationSchema.parse({ audience: 'developers', tone: 'direct', depth: 'deep', voice: 'calm', style: 'conversational' })).toThrow();
    const refs = parseInlineReferences('El dato está aquí [src/example.ts:1-2] y se amplía [docs/example.md:Introducción].', sources);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ path: 'src/example.ts', locator: 'lines', startLine: 1, endLine: 2 });
    expect(refs[1]).toMatchObject({ path: 'docs/example.md', locator: 'section', section: 'Introducción' });
  });

  it('rejects unsupported or unresolved references', () => {
    expect(() => parseInlineReferences('Ver https://example.com', sources)).not.toThrow();
    expect(() => parseInlineReferences('Ver [https://example.com:x]', sources)).toThrow();
    expect(() => parseInlineReferences('Ver [src/example.ts:20]', sources)).toThrow();
    expect(() => parseInlineReferences('Ver [docs/example.md:Ausente]', sources)).toThrow();
    expect(() => parseInlineReferences('Ver [src/example.ts:1', sources)).toThrow();
  });

  it('removes the same metadata for locution, subtitles and duration', () => {
    const text = 'Primero [src/example.ts:1] continuamos.';
    expect(locutionText(text)).toBe('Primero  continuamos.');
    expect(subtitleText(text)).toBe(locutionText(text));
    expect(durationText(text)).toBe(locutionText(text));
  });

  it('preserves all non-reference whitespace and line breaks', () => {
    const text = '  Hola  mundo[src/example.ts:1]\n\n final  ';
    expect(locutionText(text)).toBe('  Hola  mundo\n\n final  ');
  });
});
