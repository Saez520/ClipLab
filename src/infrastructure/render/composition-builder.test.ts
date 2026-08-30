import { describe, expect, it } from 'vitest';
import { buildComposition } from './composition-builder.js';
import type { StoryboardToRenderHandoff } from '../../domain/handoffs.js';
import { resolveTechnicalOutput } from '../../domain/render.js';
import { ValidationError } from '../../domain/errors.js';

const segment = (segmentId: string, position: number, durationSeconds: number, visualRepresentation = `visual-${segmentId}`) => ({
  segmentId,
  version: 1,
  narrativeSpan: `span ${segmentId}`,
  narrativeStart: position * 10,
  narrativeEnd: position * 10 + 9,
  durationSeconds,
  position,
  audio: `narration text ${segmentId}`,
  visualRepresentation,
  audiovisualMapping: { narrativeMeaning: 'm', audio: `narration text ${segmentId}`, visual: visualRepresentation, correspondence: 'c' },
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
    profile: { platform: 'generic', aspectRatio: '9:16', language: 'español', visualDensity: 'standard' },
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

describe('deterministic composition builder', () => {
  it('is byte-for-byte deterministic for identical inputs', () => {
    const first = buildComposition(handoff(), technical, narrationFiles);
    const second = buildComposition(handoff(), technical, narrationFiles);
    expect(second.indexHtml).toBe(first.indexHtml);
    expect(second.manifestJson).toBe(first.manifestJson);
    expect(first.indexHtml).not.toContain(new Date().getFullYear().toString());
  });

  it('transcribes exact accumulated slots from rhythmAndPositions in order', () => {
    const { indexHtml } = buildComposition(handoff(), technical, narrationFiles);
    expect(indexHtml).toContain('<div class="clip" id="visual-s1" data-start="0" data-duration="30" data-track-index="1">');
    expect(indexHtml).toContain('<div class="clip" id="visual-s2" data-start="30" data-duration="45" data-track-index="1">');
    expect(indexHtml).toContain('<div class="clip" id="visual-s3" data-start="75" data-duration="15.5" data-track-index="1">');
    expect(indexHtml).toContain('<audio class="clip" id="audio-s1" data-start="0" data-duration="30" data-track-index="2" src="narration/s1.wav"></audio>');
    expect(indexHtml).toContain('<audio class="clip" id="audio-s3" data-start="75" data-duration="15.5" data-track-index="2" src="narration/s3.wav"></audio>');
    // Stage dimensions derive from the approved aspect ratio.
    expect(indexHtml).toContain('data-width="1080" data-height="1920"');
  });

  it('honors the approved total duration exactly with no trims or fills', () => {
    const { indexHtml, manifestJson } = buildComposition(handoff(), technical, narrationFiles);
    expect(indexHtml).toContain('data-duration="90.5"');
    const manifest = JSON.parse(manifestJson);
    expect(manifest.source.finalDurationSeconds).toBe(90.5);
    const slotsTotal = manifest.segments.reduce((total: number, item: any) => total + item.durationSeconds, 0);
    expect(slotsTotal).toBeCloseTo(90.5, 9);
  });

  it('escapes special characters strictly and keeps the manifest traceable', () => {
    const hostile = handoff({
      finalDurationSeconds: 90,
      authorizedSegments: [segment('s<1>', 0, 90, 'visual & "quoted" <script>alert(1)</script>')],
      rhythmAndPositions: [{ segmentId: 's<1>', position: 0, durationSeconds: 90, rhythm: 'r', synchronization: 's' }],
      audioVisualMapping: [{ segmentId: 's<1>', mapping: 'c' }],
      validations: [segment('s1', 0, 90).validation],
      sources: [{ path: 'source.md', locator: '1', content: 'c', summary: 'c', segmentId: 's<1>' }]
    });
    const composition = buildComposition(hostile, technical, { 's<1>': '/x.wav' });
    expect(composition.indexHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(composition.indexHtml).toContain('visual &amp; &quot;quoted&quot;');
    // The hostile inline <script> must never appear unescaped.
    expect(composition.indexHtml).not.toContain('<script>alert(1)</script>');
    // Hostile segmentId 's<1>' must be sanitized: only [A-Za-z0-9-_], rest replaced by '-'.
    expect(composition.indexHtml).toContain('id="visual-s-1-"');
    expect(composition.indexHtml).toContain('id="audio-s-1-"');
    expect(composition.indexHtml).not.toContain('id="visual-s<1>"');
    expect(composition.indexHtml).not.toContain('id="audio-s<1>"');
    const manifest = JSON.parse(composition.manifestJson);
    expect(manifest.builder.version).toBeGreaterThan(0);
    expect(manifest.inputsSha256.handoff).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.source.storyboardRevisionId).toBe('opp-1-storyboard-revision-2');
  });

  it('registers a paused GSAP timeline on window.__timelines under the composition id', () => {
    const { indexHtml } = buildComposition(handoff(), technical, narrationFiles);
    // GSAP loaded in head.
    expect(indexHtml).toContain('<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>');
    // Registry init + assignment with the exact compositionId key.
    expect(indexHtml).toContain('window.__timelines = window.__timelines || {};');
    expect(indexHtml).toContain('const tl = gsap.timeline({ paused: true });');
    expect(indexHtml).toContain('window.__timelines["opp-1-opp-1-storyboard-revision-2"] = tl;');
    // The registry key must match the stage data-composition-id exactly.
    expect(indexHtml).toContain('data-composition-id="opp-1-opp-1-storyboard-revision-2"');
  });

  it('rejects slot sums that deviate from the approved duration and missing narration files', () => {
    expect(() => buildComposition(handoff({ finalDurationSeconds: 120 }), technical, narrationFiles)).toThrowError(/does not match the approved final duration/);
    expect(() => buildComposition(handoff(), technical, { s1: '/x.wav' })).toThrowError(ValidationError);
    expect(() => buildComposition(handoff({ profile: { ...handoff().profile, aspectRatio: '4:5' } }), technical, narrationFiles)).toThrowError(/aspect ratio/);
  });
});
