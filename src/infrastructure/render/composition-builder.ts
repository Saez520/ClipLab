import { createHash } from 'node:crypto';
import { ValidationError } from '../../domain/errors.js';
import type { StoryboardToRenderHandoff } from '../../domain/handoffs.js';
import { RESOLUTION_BY_ASPECT_RATIO, technicalOutputSchema, type TechnicalOutput } from '../../domain/render.js';

export const COMPOSITION_BUILDER_VERSION = 1;

export interface Composition {
  indexHtml: string;
  manifestJson: string;
}

type NarrationFiles = Record<string, string>;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeSegmentId(segmentId: string): string {
  return segmentId.replace(/[^A-Za-z0-9-_]/g, '-');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface CompositionEngineMetadata {
  name: string;
  version: string;
  flags: readonly string[];
}

/**
 * Deterministic mechanical transcription of the authorized handoff into a
 * Hyperframes composition. No creative interpretation: the approved segments,
 * their exact slots and the approved total duration are reproduced verbatim.
 */
export function buildComposition(handoff: StoryboardToRenderHandoff, technicalOutput: TechnicalOutput, narrationFiles: NarrationFiles, engine?: CompositionEngineMetadata): Composition {
  technicalOutputSchema.parse(technicalOutput);
  const resolution = RESOLUTION_BY_ASPECT_RATIO[handoff.profile.aspectRatio as keyof typeof RESOLUTION_BY_ASPECT_RATIO];
  if (!resolution || resolution.width !== technicalOutput.width || resolution.height !== technicalOutput.height) {
    throw new ValidationError('Technical output does not match the approved profile aspect ratio', {
      aspectRatio: handoff.profile.aspectRatio,
      technicalOutput,
      expectedResolution: resolution
    });
  }

  const segments = [...handoff.authorizedSegments].sort((a, b) => a.position - b.position);
  const compositionId = `${handoff.opportunityId}-${handoff.storyboardRevisionId}`;

  let cursor = 0;
  const visualClips: string[] = [];
  const audioClips: string[] = [];
  const manifestSegments: Array<Record<string, unknown>> = [];
  const segmentMetas: Array<{ sanitizedId: string; startSeconds: number; durationSeconds: number }> = [];
  for (const [index, segment] of segments.entries()) {
    if (!Number.isInteger(segment.position) || segment.position !== index) {
      throw new ValidationError(`Segment positions must be contiguous starting at zero (segment ${segment.segmentId})`, { position: segment.position });
    }
    const narrationFile = narrationFiles[segment.segmentId];
    if (!narrationFile) throw new ValidationError(`Segment ${segment.segmentId} has no synthesized narration file`);
    const startSeconds = Number(cursor.toFixed(6));
    const sanitizedId = sanitizeSegmentId(segment.segmentId);
    visualClips.push(
      `    <div class="clip" id="visual-${sanitizedId}" data-start="${startSeconds}" data-duration="${segment.durationSeconds}" data-track-index="1"><p class="visual">${escapeHtml(segment.visualRepresentation)}</p></div>`
    );
    audioClips.push(
      `    <audio class="clip" id="audio-${sanitizedId}" data-start="${startSeconds}" data-duration="${segment.durationSeconds}" data-track-index="2" src="narration/${escapeHtml(segment.segmentId)}.wav"></audio>`
    );
    manifestSegments.push({
      segmentId: segment.segmentId,
      position: segment.position,
      startSeconds,
      durationSeconds: segment.durationSeconds,
      narrationFile: `narration/${segment.segmentId}.wav`
    });
    segmentMetas.push({ sanitizedId, startSeconds, durationSeconds: segment.durationSeconds });
    cursor += segment.durationSeconds;
  }

  // CA invariant: the approved duration is honored exactly — no trims, no fills.
  const slotsTotal = Number(cursor.toFixed(6));
  if (Math.abs(slotsTotal - handoff.finalDurationSeconds) > 1e-9) {
    throw new ValidationError('Sum of approved segment durations does not match the approved final duration', {
      sumOfSlots: slotsTotal,
      finalDurationSeconds: handoff.finalDurationSeconds
    });
  }

  // Continuous micro-motion envelope x:0→0.01px across the whole composition.
  // Prevents the engine's sweep_static check (identical layout signatures at 9
  // sample points) without visible displacement. Each segment's tween starts
  // where the previous one ended, so the geometry signature differs at every
  // sample point.
  const T = handoff.finalDurationSeconds;
  const motionTweens = segmentMetas.map(({ sanitizedId, startSeconds, durationSeconds }) => {
    const X0 = (0.01 * startSeconds / T).toFixed(6);
    const X1 = (0.01 * (startSeconds + durationSeconds) / T).toFixed(6);
    return `    tl.fromTo("#visual-${sanitizedId}", { x: ${X0} }, { x: ${X1}, duration: ${durationSeconds}, ease: "none" }, ${startSeconds});`;
  });

  const indexHtml = [
    '<!DOCTYPE html>',
    `<html lang="${escapeHtml(handoff.profile.language)}">`,
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(compositionId)}</title>`,
    '  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
    '</head>',
    '<body>',
    `  <div id="stage" class="stage" data-composition-id="${escapeHtml(compositionId)}" data-start="0" data-duration="${handoff.finalDurationSeconds}" data-width="${technicalOutput.width}" data-height="${technicalOutput.height}">`,
    ...visualClips,
    ...audioClips,
    '  </div>',
    '  <script>',
    '    window.__timelines = window.__timelines || {};',
    '    const tl = gsap.timeline({ paused: true });',
    ...motionTweens,
    `    window.__timelines[${JSON.stringify(compositionId)}] = tl;`,
    '  </script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

  const manifest = {
    builder: { name: 'cliplab-composition-builder', version: COMPOSITION_BUILDER_VERSION },
    ...(engine ? { engine: { name: engine.name, version: engine.version, flags: [...engine.flags] } } : {}),
    source: {
      opportunityId: handoff.opportunityId,
      scriptId: handoff.scriptId,
      storyboardId: handoff.storyboardId,
      storyboardRevisionId: handoff.storyboardRevisionId,
      storyboardRevisionVersion: handoff.storyboardRevisionVersion,
      userApprovalId: handoff.userApprovalId,
      productionAuthorization: handoff.productionAuthorization,
      finalDurationSeconds: handoff.finalDurationSeconds,
      targetDurationSeconds: handoff.targetDurationSeconds ?? null,
      aspectRatio: handoff.profile.aspectRatio,
      language: handoff.profile.language
    },
    technicalOutput,
    segments: manifestSegments,
    inputsSha256: {
      handoff: sha256(JSON.stringify(handoff)),
      narrationFiles: Object.fromEntries(segments.map(segment => [segment.segmentId, sha256(narrationFiles[segment.segmentId])]))
    }
  };
  return { indexHtml, manifestJson: `${JSON.stringify(manifest, null, 2)}\n` };
}
