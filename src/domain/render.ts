import { z } from 'zod';
import { ValidationError } from './errors.js';

const id = z.string().min(1);

export const RENDER_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type RenderState = typeof RENDER_STATES[number];
export const RENDER_STAGES = ['PREFLIGHT', 'NARRATION', 'COMPOSITION', 'VALIDATION', 'ENCODING'] as const;
export type RenderStage = typeof RENDER_STAGES[number];
export const RENDER_FAILURE_CLASSES = ['ENVIRONMENT', 'SPECIFICATION', 'UNCLASSIFIED'] as const;
export type RenderFailureClass = typeof RENDER_FAILURE_CLASSES[number];

// Technical output defaults per environment profile: fps is fixed at 30 for
// both development and production until production indicates otherwise.
export const TECHNICAL_OUTPUT_DEFAULTS = { development: { fps: 30 }, production: { fps: 30 } } as const;
export type TechnicalProfile = keyof typeof TECHNICAL_OUTPUT_DEFAULTS;

// Resolution derived from the approved publication profile aspect ratio.
export const RESOLUTION_BY_ASPECT_RATIO = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 }
} as const;

// Post-render duration tolerance vs approved duration (±2 frames at target fps).
export const DURATION_TOLERANCE_FRAMES = 2;
// Deterministic adaptive-rate narration passes before classifying SPECIFICATION.
export const MAX_RATE_ADAPTATION_PASSES = 3;

export const technicalOutputSchema = z.object({
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
}).strict();
export type TechnicalOutput = z.infer<typeof technicalOutputSchema>;

export const renderStateSchema = z.enum(RENDER_STATES);
export const renderStageSchema = z.enum(RENDER_STAGES);
export const renderFailureClassSchema = z.enum(RENDER_FAILURE_CLASSES);

export const renderFailureSchema = z.object({
  failureClass: renderFailureClassSchema,
  stage: renderStageSchema,
  cause: z.string().min(1),
  segmentId: id.optional(),
  suggestedAction: z.string().min(1),
  rawExcerpt: z.string().optional()
}).strict();
export type RenderFailure = z.infer<typeof renderFailureSchema>;

export const renderResultSchema = z.object({
  outputPath: z.string().min(1),
  sha256: z.string().min(1),
  durationSeconds: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive()
}).strict();
export type RenderResult = z.infer<typeof renderResultSchema>;

export const renderQueueEntrySchema = z.object({
  renderId: id,
  opportunityId: id,
  storyboardId: id,
  storyboardRevisionId: id,
  userApprovalId: id,
  productionAuthorizationId: id,
  state: renderStateSchema,
  stage: renderStageSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
}).strict();
export type RenderQueueEntry = z.infer<typeof renderQueueEntrySchema>;

export const renderAttemptOutcomeSchema = z.enum(['STARTED', 'SUCCEEDED', 'FAILED']);

export const renderAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  actor: id,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  outcome: renderAttemptOutcomeSchema.optional(),
  failureClass: renderFailureClassSchema.optional(),
  failureCause: z.string().optional(),
  logExcerpt: z.string().optional()
}).strict();
export type RenderAttempt = z.infer<typeof renderAttemptSchema>;

// ---- Ports (implemented by infrastructure; fakes injected in tests) ----

export interface VoiceSynthesis {
  filePath: string;
  durationSeconds?: number;
}

/** Port for deterministic narration synthesis with rate adaptation. */
export interface VoiceSynthesizer {
  /** Throws RenderEnvironmentError when no usable voice is available. */
  preflight(): Promise<void>;
  /**
   * Synthesizes `text` so its natural duration fits inside
   * `targetDurationSeconds` using deterministic rate adaptation.
   * When `outputDir` is provided the resulting file is written there
   * (per-render working directory created by the service).
   * Throws RenderSpecificationError when even the maximum passes exceed the slot.
   */
  synthesize(text: string, targetDurationSeconds: number, outputDir?: string): Promise<VoiceSynthesis>;
}

export interface RenderCliRequest {
  compositionDir: string;
  outputPath: string;
  fps: number;
}

export interface RenderCliResult {
  outputPath: string;
  durationSeconds: number;
}

/** Port over the deterministic render engine surface (CLI subprocess). */
export interface VideoRenderer {
  /** Throws RenderEnvironmentError when engine dependencies are missing. */
  preflight(): Promise<void>;
  /** Exit != 0 throws RenderSpecificationError with raw validator findings. */
  lint(compositionDir: string): Promise<void>;
  check(compositionDir: string): Promise<void>;
  render(request: RenderCliRequest): Promise<RenderCliResult>;
}

// ---- Invariants ----

export function resolveTechnicalOutput(profileEnv: string | undefined, aspectRatio: string): TechnicalOutput {
  const profile = profileEnv ?? 'development';
  const defaults = TECHNICAL_OUTPUT_DEFAULTS[profile as TechnicalProfile];
  if (!defaults) throw new ValidationError(`Unknown render profile: ${profile}`, { profile, knownProfiles: Object.keys(TECHNICAL_OUTPUT_DEFAULTS) });
  const resolution = RESOLUTION_BY_ASPECT_RATIO[aspectRatio as keyof typeof RESOLUTION_BY_ASPECT_RATIO];
  if (!resolution) throw new ValidationError(`Unknown aspect ratio: ${aspectRatio}`, { aspectRatio, knownAspectRatios: Object.keys(RESOLUTION_BY_ASPECT_RATIO) });
  return technicalOutputSchema.parse({ fps: defaults.fps, ...resolution });
}

export function assertOutputDuration(actualSeconds: number, expectedSeconds: number, fps: number): void {
  const toleranceSeconds = DURATION_TOLERANCE_FRAMES / fps;
  if (!Number.isFinite(actualSeconds)) throw new ValidationError('Measured output duration is not a finite number', { actualDurationSeconds: actualSeconds, expectedDurationSeconds: expectedSeconds });
  if (Math.abs(actualSeconds - expectedSeconds) > toleranceSeconds) {
    throw new ValidationError(
      `Output duration deviates from the approved duration beyond tolerance of ±${DURATION_TOLERANCE_FRAMES} frames: measured ${actualSeconds}s vs approved ${expectedSeconds}s`,
      { actualDurationSeconds: actualSeconds, expectedDurationSeconds: expectedSeconds, toleranceFrames: DURATION_TOLERANCE_FRAMES, fps }
    );
  }
}
