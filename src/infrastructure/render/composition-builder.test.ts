import { describe, expect, it } from 'vitest';
import { buildComposition } from './composition-builder.js';
import type { StoryboardToRenderHandoff } from '../../domain/handoffs.js';
import { resolveTechnicalOutput } from '../../domain/render.js';
import { ValidationError } from '../../domain/errors.js';
import { CompositionTemplateError } from '../../domain/errors.js';
import { resolve } from 'node:path';

const FIXTURES = resolve(__dirname, '../../../tests/fixtures/composition-templates');

const segment = (segmentId: string, position: number, durationSeconds: number, visualRepresentation = `visual-${segmentId}`, narrativeMeaning = 'm', correspondence = 'c') => ({
  segmentId,
  version: 1,
  narrativeSpan: `span ${segmentId}`,
  narrativeStart: position * 10,
  narrativeEnd: position * 10 + 9,
  durationSeconds,
  position,
  audio: `narration text ${segmentId}`,
  visualRepresentation,
  audiovisualMapping: { narrativeMeaning, audio: `narration text ${segmentId}`, visual: visualRepresentation, correspondence },
  rhythm: 'steady',
  synchronization: 'sync',
  sourceReferences: [{ path: 'source.md', locator: '1', content: 'content', summary: 'content', segmentId }],
  technicalConditions: [],
  technicalCoverage: [],
  dependsOn: [],
  validation: {
    supportsNarrative: true, preservesTechnicalConditions: true, introducesUnsupportedClaims: false, usesAudioAsSubtitlesOnly: false,
    editorialChange: false, reasons: [], requiredConditionIds: [], coveredConditionIds: [], missingConditionIds: [], unknownConditionIds: [],
    duplicateConditionIds: [], contradictoryConditionIds: [], ambiguousConditionExpressions: []
  }
});

function handoff(overrides: Partial<StoryboardToRenderHandoff> = {}): StoryboardToRenderHandoff {
  return {
    opportunityId: 'opp-1',
    scriptId: 'opp-1-script-1',
    authorizedScript: 'script text',
    directorValidationId: 'dv-1',
    scriptAuthorization: '12',
    storyboardId: 'opp-1-storyboard',
    storyboardRevisionId: 'opp-1-storyboard-revision-2',
    storyboardRevisionVersion: 2,
    authorizedSegments: [segment('s1', 0, 30), segment('s2', 1, 45), segment('s3', 2, 15.5)],
    audioVisualMapping: [
      { segmentId: 's1', mapping: 'c' }, { segmentId: 's2', mapping: 'c' }, { segmentId: 's3', mapping: 'c' }
    ],
    rhythmAndPositions: [
      { segmentId: 's1', position: 0, durationSeconds: 30, rhythm: 'steady', synchronization: 'sync' },
      { segmentId: 's2', position: 1, durationSeconds: 45, rhythm: 'steady', synchronization: 'sync' },
      { segmentId: 's3', position: 2, durationSeconds: 15.5, rhythm: 'steady', synchronization: 'sync' }
    ],
    visualSpecification: { aspectRatio: '9:16', visualDensity: 'standard', language: 'español' },
    finalDurationSeconds: 90.5,
    profile: { platform: 'generic', aspectRatio: '9:16', language: 'español', visualDensity: 'standard', compositionTemplate: 'pulso' },
    sources: [{ path: 'source.md', locator: '1', content: 'content', summary: 'content', segmentId: 's1' }],
    validations: [segment('s1', 0, 30).validation],
    corrections: [],
    userApprovalId: 'opp-1-approval-1',
    productionAuthorization: '42',
    state: 'AUTHORIZED_FOR_PRODUCTION',
    ...overrides
  } as StoryboardToRenderHandoff;
}

const narrationFiles = { s1: '/renders/r-1/narration/s1.wav', s2: '/renders/r-1/narration/s2.wav', s3: '/renders/r-1/narration/s3.wav' };
const technical = resolveTechnicalOutput('development', '9:16');

describe('deterministic composition builder (v2 with templates)', () => {
  it('is byte-for-byte deterministic for identical inputs', () => {
    const first = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    const second = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    expect(second.indexHtml).toBe(first.indexHtml);
    expect(second.manifestJson).toBe(first.manifestJson);
    expect(first.indexHtml).not.toContain(new Date().getFullYear().toString());
  });

  it('injects template CSS with --accent-cyan token in <head> and emits meta-bar + badge + blocks', () => {
    const { indexHtml } = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    // CSS injected after GSAP script.
    expect(indexHtml).toContain('--accent-cyan:#10c8f0');
    // meta-bar present.
    expect(indexHtml).toContain('class="meta-bar"');
    // badge present.
    expect(indexHtml).toContain('class="badge badge--cyan"');
    // CERO <p class="visual"> (old plain-text format eliminated).
    expect(indexHtml).not.toContain('<p class="visual">');
  });

  it('registers template metadata and builder version 2 in manifest', () => {
    const { manifestJson } = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    const manifest = JSON.parse(manifestJson);
    expect(manifest.template.name).toBe('pulso');
    expect(manifest.template.version).toBe('1.1.0');
    expect(manifest.template.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.builder.version).toBe(3);
    // Existing manifest fields preserved.
    expect(manifest.source.finalDurationSeconds).toBe(90.5);
    expect(manifest.inputsSha256.handoff).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.segments).toHaveLength(3);
  });

  it('selects a different template (aurora) when specified in profile', () => {
    const { indexHtml, manifestJson } = buildComposition(
      handoff({ profile: { ...handoff().profile, compositionTemplate: 'aurora' } }),
      technical, narrationFiles, undefined, { templatesRoot: FIXTURES }
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.template.name).toBe('aurora');
    // Aurora CSS uses violet accent.
    expect(indexHtml).toContain('#7088f8');
  });

  it('throws CompositionTemplateError (no HTML produced) for an unknown template name', () => {
    expect(() => {
      buildComposition(
        handoff({ profile: { ...handoff().profile, compositionTemplate: 'no-existe' } }),
        technical, narrationFiles, undefined, { templatesRoot: FIXTURES }
      );
    }).toThrow(CompositionTemplateError);
  });

  it('escapes hostile visual content within template blocks', () => {
    const hostile = handoff({
      finalDurationSeconds: 90,
      authorizedSegments: [segment('s<1>', 0, 90, 'visual & "quoted" <script>alert(1)</script>')],
      rhythmAndPositions: [{ segmentId: 's<1>', position: 0, durationSeconds: 90, rhythm: 'r', synchronization: 's' }],
      audioVisualMapping: [{ segmentId: 's<1>', mapping: 'c' }],
      validations: [segment('s1', 0, 90).validation],
      sources: [{ path: 'source.md', locator: '1', content: 'c', summary: 'c', segmentId: 's<1>' }]
    });
    const composition = buildComposition(hostile, technical, { 's<1>': '/x.wav' }, undefined, { templatesRoot: FIXTURES });
    expect(composition.indexHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(composition.indexHtml).not.toContain('<script>alert(1)</script>');
    // Hostile segmentId sanitized.
    expect(composition.indexHtml).toContain('id="visual-s-1-"');
    expect(composition.indexHtml).not.toContain('id="visual-s<1>"');
  });

  it('preserves audio clips and exact clip attrs (id/data-start/duration/track-index)', () => {
    const { indexHtml } = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    expect(indexHtml).toContain('<div class="clip" id="visual-s1" data-start="0" data-duration="30" data-track-index="1" style="position:absolute; inset:0;">');
    expect(indexHtml).toContain('<div class="clip" id="visual-s2" data-start="30" data-duration="45" data-track-index="1" style="position:absolute; inset:0;">');
    expect(indexHtml).toContain('<div class="clip" id="visual-s3" data-start="75" data-duration="15.5" data-track-index="1" style="position:absolute; inset:0;">');
    // Visual clips wrapped in content-stack (standard layout).
    expect(indexHtml).toContain('<div class="content-stack">');
    expect(indexHtml).toContain('<audio class="clip" id="audio-s1" data-start="0" data-duration="30" data-track-index="2" src="narration/s1.wav"></audio>');
    expect(indexHtml).toContain('<audio class="clip" id="audio-s3" data-start="75" data-duration="15.5" data-track-index="2" src="narration/s3.wav"></audio>');
    expect(indexHtml).toContain('data-width="1080" data-height="1920"');
  });

  it('emits a continuous micro-motion tween per visual segment with exact X0/X1 (tweens intact)', () => {
    const { indexHtml } = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    expect(indexHtml).toContain('tl.fromTo("#visual-s1", { x: 0.000000 }, { x: 0.003315, duration: 30, ease: "none" }, 0);');
    expect(indexHtml).toContain('tl.fromTo("#visual-s2", { x: 0.003315 }, { x: 0.008287, duration: 45, ease: "none" }, 30);');
    expect(indexHtml).toContain('tl.fromTo("#visual-s3", { x: 0.008287 }, { x: 0.010000, duration: 15.5, ease: "none" }, 75);');
    expect(indexHtml).not.toMatch(/tl\.fromTo\("#audio-/);
  });

  it('honors the approved total duration exactly with no trims or fills', () => {
    const { indexHtml, manifestJson } = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    expect(indexHtml).toContain('data-duration="90.5"');
    const manifest = JSON.parse(manifestJson);
    expect(manifest.source.finalDurationSeconds).toBe(90.5);
    const slotsTotal = manifest.segments.reduce((total: number, item: any) => total + item.durationSeconds, 0);
    expect(slotsTotal).toBeCloseTo(90.5, 9);
  });

  it('rejects slot sums that deviate from the approved duration and missing narration files', () => {
    expect(() => buildComposition(handoff({ finalDurationSeconds: 120 }), technical, narrationFiles, undefined, { templatesRoot: FIXTURES })).toThrowError(/does not match the approved final duration/);
    expect(() => buildComposition(handoff(), technical, { s1: '/x.wav' }, undefined, { templatesRoot: FIXTURES })).toThrowError(ValidationError);
    expect(() => buildComposition(handoff({ profile: { ...handoff().profile, aspectRatio: '4:5' } }), technical, narrationFiles, undefined, { templatesRoot: FIXTURES })).toThrowError(/aspect ratio/);
  });

  // R3-001: hero clip must render with non-empty .letter__char content (no empty .letters block).
  it('renders hero clip with non-empty letter content (R3-001)', () => {
    const heroHandoff = handoff({
      finalDurationSeconds: 90,
      authorizedSegments: [segment('h1', 0, 90, 'La API (Interfaz de Programación de Aplicaciones) conecta todo', 'hero', 'hero')],
      rhythmAndPositions: [{ segmentId: 'h1', position: 0, durationSeconds: 90, rhythm: 'r', synchronization: 's' }],
      audioVisualMapping: [{ segmentId: 'h1', mapping: 'c' }],
      validations: [segment('h1', 0, 90).validation],
      sources: [{ path: 'source.md', locator: '1', content: 'c', summary: 'c', segmentId: 'h1' }]
    });
    const { indexHtml } = buildComposition(heroHandoff, technical, { h1: '/x.wav' }, undefined, { templatesRoot: FIXTURES });
    // The letters block must contain the acronym char.
    expect(indexHtml).toContain('class="letters"');
    expect(indexHtml).toContain('class="letter__char"');
    expect(indexHtml).toContain('API');
    // Must NOT render an empty .letters div.
    expect(indexHtml).not.toContain('<div class="letters"></div>');
    // Must NOT render an empty letter__char span.
    expect(indexHtml).not.toContain('<span class="letter__char"></span>');
  });

  // R3-002: badge pill must not render empty when narrativeMeaning is empty/whitespace.
  it('omits badge pill when badge content is empty (R3-002)', () => {
    const noBadgeHandoff = handoff({
      finalDurationSeconds: 90,
      authorizedSegments: [segment('b1', 0, 90, 'entrada X → salida Y', '', 'transformación')],
      rhythmAndPositions: [{ segmentId: 'b1', position: 0, durationSeconds: 90, rhythm: 'r', synchronization: 's' }],
      audioVisualMapping: [{ segmentId: 'b1', mapping: 'c' }],
      validations: [segment('b1', 0, 90).validation],
      sources: [{ path: 'source.md', locator: '1', content: 'c', summary: 'c', segmentId: 'b1' }]
    });
    const { indexHtml } = buildComposition(noBadgeHandoff, technical, { b1: '/x.wav' }, undefined, { templatesRoot: FIXTURES });
    // No empty badge pill rendered.
    expect(indexHtml).not.toContain('<span class="badge badge--cyan"></span>');
  });

  // R3-003: GSAP timeline registry (window.__timelines) must be present per composition.
  it('registers the GSAP timeline in window.__timelines (R3-003)', () => {
    const { indexHtml } = buildComposition(handoff(), technical, narrationFiles, undefined, { templatesRoot: FIXTURES });
    expect(indexHtml).toContain('window.__timelines = window.__timelines || {};');
    expect(indexHtml).toContain('window.__timelines[');
    // The composition ID is used as the key.
    expect(indexHtml).toContain('opp-1-opp-1-storyboard-revision-2');
  });

  // R3-003: escaping must handle quotes (&quot;) for XSS safety.
  it('escapes double quotes as &quot; in visual content (R3-003)', () => {
    const quoteHandoff = handoff({
      finalDurationSeconds: 90,
      authorizedSegments: [segment('q1', 0, 90, 'dijo "hola" → respondió "adiós"', 'diálogo', 'transformación')],
      rhythmAndPositions: [{ segmentId: 'q1', position: 0, durationSeconds: 90, rhythm: 'r', synchronization: 's' }],
      audioVisualMapping: [{ segmentId: 'q1', mapping: 'c' }],
      validations: [segment('q1', 0, 90).validation],
      sources: [{ path: 'source.md', locator: '1', content: 'c', summary: 'c', segmentId: 'q1' }]
    });
    const { indexHtml } = buildComposition(quoteHandoff, technical, { q1: '/x.wav' }, undefined, { templatesRoot: FIXTURES });
    // Quotes must be escaped.
    expect(indexHtml).toContain('&quot;hola&quot;');
    expect(indexHtml).toContain('&quot;adiós&quot;');
    // Raw quotes must not appear in the output (XSS prevention).
    expect(indexHtml).not.toMatch(/>dijo "hola"</);
  });
});
