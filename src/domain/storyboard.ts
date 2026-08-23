import { z } from 'zod';
import { StoryboardApprovalRequiredError, StoryboardStateError, ValidationError } from './errors.js';
import { technicalConditionSchema, technicalEvidenceSchema, type TechnicalCondition } from './technical-conditions.js';
export { compareTechnicalConditions, extractTechnicalConditions, canonicalizeTechnicalValue, technicalConditionKey, technicalConditionSchema, technicalEvidenceSchema } from './technical-conditions.js';
export type { TechnicalCondition, TechnicalEvidence, TechnicalExtraction, TechnicalCanonicalValue } from './technical-conditions.js';

const id = z.string().min(1);
const text = z.string().min(1);

export const STORYBOARD_STATES = [
  'STORYBOARD_DRAFT',
  'STORYBOARD_BLOCKED',
  'STORYBOARD_READY_FOR_USER_APPROVAL',
  'STORYBOARD_USER_APPROVED',
  'STORYBOARD_CORRECTION_REQUESTED',
  'STORYBOARD_SUPERSEDED'
] as const;
export type StoryboardState = typeof STORYBOARD_STATES[number];

export const STORYBOARD_TRANSITIONS = [
  { from: 'STORYBOARD_DRAFT', to: 'STORYBOARD_BLOCKED' },
  { from: 'STORYBOARD_DRAFT', to: 'STORYBOARD_READY_FOR_USER_APPROVAL' },
  { from: 'STORYBOARD_READY_FOR_USER_APPROVAL', to: 'STORYBOARD_USER_APPROVED' },
  { from: 'STORYBOARD_READY_FOR_USER_APPROVAL', to: 'STORYBOARD_CORRECTION_REQUESTED' },
  { from: 'STORYBOARD_READY_FOR_USER_APPROVAL', to: 'STORYBOARD_BLOCKED' },
  { from: 'STORYBOARD_USER_APPROVED', to: 'STORYBOARD_SUPERSEDED' },
  { from: 'STORYBOARD_USER_APPROVED', to: 'STORYBOARD_CORRECTION_REQUESTED' },
  { from: 'STORYBOARD_CORRECTION_REQUESTED', to: 'STORYBOARD_READY_FOR_USER_APPROVAL' },
  { from: 'STORYBOARD_CORRECTION_REQUESTED', to: 'STORYBOARD_BLOCKED' },
  { from: 'STORYBOARD_CORRECTION_REQUESTED', to: 'STORYBOARD_SUPERSEDED' },
  { from: 'STORYBOARD_BLOCKED', to: 'STORYBOARD_CORRECTION_REQUESTED' },
  { from: 'STORYBOARD_BLOCKED', to: 'STORYBOARD_SUPERSEDED' }
] as const;

export const DEFAULT_PUBLICATION_PROFILE = {
  platform: 'generic',
  aspectRatio: '9:16',
  language: 'español',
  visualDensity: 'standard'
} as const;
export const PREFERRED_DURATION_SECONDS = { min: 30, max: 90 } as const;
export const MAX_DURATION_WITHOUT_EXPLICIT_APPROVAL = 90;

export const publicationProfileSchema = z.object({
  platform: text.default(DEFAULT_PUBLICATION_PROFILE.platform),
  aspectRatio: text.default(DEFAULT_PUBLICATION_PROFILE.aspectRatio),
  language: text.default(DEFAULT_PUBLICATION_PROFILE.language),
  visualDensity: z.enum(['sparse', 'standard', 'dense']).default(DEFAULT_PUBLICATION_PROFILE.visualDensity)
}).strict();
export type PublicationProfile = z.infer<typeof publicationProfileSchema>;

export const resolvedSourceSchema = z.object({
  sourceId: id.optional(),
  path: text,
  locator: text,
  content: text.optional(),
  summary: text.optional(),
  segmentId: id
}).strict().superRefine((source, context) => {
  if (!source.content && !source.summary) context.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'Resolved sources require content or summary' });
});
export type ResolvedSource = z.infer<typeof resolvedSourceSchema>;

export const audioVisualMappingSchema = z.object({
  narrativeMeaning: text,
  audio: text,
  visual: text,
  correspondence: text
}).strict();
export type AudioVisualMapping = z.infer<typeof audioVisualMappingSchema>;

export const segmentValidationSchema = z.object({
  supportsNarrative: z.boolean(),
  preservesTechnicalConditions: z.boolean(),
  introducesUnsupportedClaims: z.boolean(),
  usesAudioAsSubtitlesOnly: z.boolean(),
  editorialChange: z.boolean().default(false),
  reasons: z.array(text).default([]),
  requiredConditionIds: z.array(id).default([]),
  coveredConditionIds: z.array(id).default([]),
  missingConditionIds: z.array(id).default([]),
  unknownConditionIds: z.array(id).default([]),
  duplicateConditionIds: z.array(id).default([]),
  contradictoryConditionIds: z.array(id).default([]),
  ambiguousConditionExpressions: z.array(text).default([])
}).strict();
export type SegmentValidation = z.infer<typeof segmentValidationSchema>;

export const technicalApplicationModes = ['overlay', 'diagrama', 'estado UI', 'especificación salida', 'audiovisual'] as const;
export const technicalCoverageProposalSchema = z.object({
  conditionId: id,
  applicationMode: z.enum(technicalApplicationModes),
  instruction: text.optional()
}).strict();
export type TechnicalCoverageProposal = z.infer<typeof technicalCoverageProposalSchema>;

export const technicalCoverageSchema = technicalCoverageProposalSchema.extend({
  condition: technicalConditionSchema,
  evidence: technicalEvidenceSchema
}).strict();
export type TechnicalCoverage = z.infer<typeof technicalCoverageSchema>;

// This is deliberately separate from resolvedSourceSchema: source content is
// resolved by the server from the validated narrative, never trusted from a
// storyboard proposal.
export const storyboardSourceProposalSchema = z.object({
  path: text,
  locator: text,
  segmentId: id
}).strict();

export const storyboardSegmentProposalSchema = z.object({
  segmentId: id,
  narrativeSpan: text,
  narrativeStart: z.number().int().nonnegative(),
  narrativeEnd: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  audio: text,
  visualRepresentation: text,
  audiovisualMapping: audioVisualMappingSchema,
  rhythm: text,
  synchronization: text,
  sourceReferences: z.array(storyboardSourceProposalSchema).min(1),
  technicalCoverage: z.array(technicalCoverageProposalSchema),
  dependsOn: z.array(id).default([]),
  reviewNote: text.optional()
}).strict().superRefine((proposal, context) => {
  if (proposal.narrativeEnd <= proposal.narrativeStart) context.addIssue({ code: z.ZodIssueCode.custom, path: ['narrativeEnd'], message: 'Narrative range must have a positive length' });
});
export type StoryboardSegmentProposal = z.infer<typeof storyboardSegmentProposalSchema>;

export const storyboardSegmentSchema = z.object({
  segmentId: id,
  version: z.number().int().positive().default(1),
  narrativeSpan: text,
  narrativeStart: z.number().int().nonnegative(),
  narrativeEnd: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  position: z.number().int().nonnegative(),
  audio: text,
  visualRepresentation: text,
  audiovisualMapping: audioVisualMappingSchema,
  rhythm: text,
  synchronization: text,
  sourceReferences: z.array(resolvedSourceSchema).min(1),
  technicalConditions: z.array(technicalConditionSchema).default([]),
  technicalCoverage: z.array(technicalCoverageSchema).default([]),
  dependsOn: z.array(id).default([]),
  reviewNote: text.optional(),
  validation: segmentValidationSchema
}).strict().superRefine((segment, context) => {
  if (segment.narrativeEnd <= segment.narrativeStart) context.addIssue({ code: z.ZodIssueCode.custom, path: ['narrativeEnd'], message: 'Narrative range must have a positive length' });
  if (segment.visualRepresentation.trim() === segment.audio.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['visualRepresentation'], message: 'Audio repeated as subtitles is not a dual-channel representation' });
  }
  if (segment.validation.usesAudioAsSubtitlesOnly) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validation', 'usesAudioAsSubtitlesOnly'], message: 'Audio-only subtitles are not a valid visual representation' });
  }
  const projectedTechnicalValidity = segment.validation.missingConditionIds.length === 0
    && segment.validation.unknownConditionIds.length === 0
    && segment.validation.duplicateConditionIds.length === 0
    && segment.validation.contradictoryConditionIds.length === 0
    && segment.validation.ambiguousConditionExpressions.length === 0
    && segment.validation.requiredConditionIds.length === segment.validation.coveredConditionIds.length;
  if (segment.validation.preservesTechnicalConditions !== projectedTechnicalValidity) context.addIssue({ code: z.ZodIssueCode.custom, path: ['validation', 'preservesTechnicalConditions'], message: 'preservesTechnicalConditions must be projected from technical validation results' });
  if (!segment.validation.supportsNarrative || !segment.validation.preservesTechnicalConditions || segment.validation.introducesUnsupportedClaims || segment.validation.editorialChange) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validation'], message: 'Segment has a material validation problem' });
  }
  const conditionIds = segment.technicalConditions.map(condition => condition.conditionId);
  const coverageIds = segment.technicalCoverage.map(coverage => coverage.conditionId);
  if (new Set(conditionIds).size !== conditionIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['technicalConditions'], message: 'Technical condition IDs must be unique' });
  if (new Set(coverageIds).size !== coverageIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['technicalCoverage'], message: 'Technical coverage IDs must be unique' });
  if (segment.technicalCoverage.some(coverage => !conditionIds.includes(coverage.conditionId))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['technicalCoverage'], message: 'Technical coverage contains an unknown condition' });
});
export type StoryboardSegment = z.infer<typeof storyboardSegmentSchema>;

export const storyboardCorrectionSchema = z.object({
  correctionId: id.optional(),
  segmentId: id,
  expectedAdjustment: text,
  requestedBy: id,
  requestedAt: text.optional(),
  status: z.enum(['PENDING', 'APPLIED', 'REJECTED']).default('PENDING'),
  editorialChange: z.boolean().default(false),
  recipient: z.enum(['STORYBOARD', 'DIRECTOR']).default('STORYBOARD')
}).strict();
export type StoryboardCorrection = z.infer<typeof storyboardCorrectionSchema>;

export const storyboardRevisionSchema = z.object({
  opportunityId: id,
  storyboardId: id,
  storyboardRevisionId: id,
  version: z.number().int().positive(),
  state: z.enum(STORYBOARD_STATES),
  scriptId: id,
  directorValidationId: id,
  scriptAuthorization: id,
  profile: publicationProfileSchema,
  segments: z.array(storyboardSegmentSchema).min(1),
  finalDurationSeconds: z.number().positive(),
  targetDurationSeconds: z.number().positive().optional(),
  sources: z.array(resolvedSourceSchema).min(1),
  validations: z.array(segmentValidationSchema).min(1),
  corrections: z.array(storyboardCorrectionSchema).default([]),
  blockedReason: text.optional(),
  blockedRecipient: id.optional(),
  createdAt: text
}).strict().superRefine((revision, context) => {
  const positions = revision.segments.map(segment => segment.position);
  if (new Set(positions).size !== positions.length || positions.some((position, index) => position !== index)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['segments'], message: 'Segments must have deterministic contiguous positions' });
  }
  if (revision.state === 'STORYBOARD_BLOCKED' && !revision.blockedReason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['blockedReason'], message: 'Blocked storyboards require a reason' });
});
export type StoryboardRevision = z.infer<typeof storyboardRevisionSchema>;

export const storyboardSchema = z.object({
  opportunityId: id,
  storyboardId: id,
  currentRevisionId: id,
  currentRevisionVersion: z.number().int().positive(),
  state: z.enum(STORYBOARD_STATES),
  createdAt: text,
  updatedAt: text
}).strict();
export type Storyboard = z.infer<typeof storyboardSchema>;

export function assertStoryboardTransition(from: StoryboardState, to: StoryboardState): void {
  if (!STORYBOARD_TRANSITIONS.some(transition => transition.from === from && transition.to === to)) {
    throw new StoryboardStateError(`Storyboard transition ${from} to ${to} is not allowed`);
  }
}

export function normalizePublicationProfile(input: unknown): PublicationProfile {
  return publicationProfileSchema.parse({ ...DEFAULT_PUBLICATION_PROFILE, ...((input ?? {}) as Record<string, unknown>) });
}

export function finalDuration(segments: readonly Pick<StoryboardSegment, 'durationSeconds'>[]): number {
  const duration = segments.reduce((total, segment) => total + segment.durationSeconds, 0);
  if (!(duration > 0)) throw new ValidationError('Storyboard duration must be positive');
  return duration;
}

export function isPreferredDuration(durationSeconds: number): boolean {
  return durationSeconds >= PREFERRED_DURATION_SECONDS.min && durationSeconds <= PREFERRED_DURATION_SECONDS.max;
}

export function requiresExplicitApproval(durationSeconds: number): boolean {
  return durationSeconds > MAX_DURATION_WITHOUT_EXPLICIT_APPROVAL;
}

export function validateStoryboardSegment(segment: unknown): StoryboardSegment {
  return storyboardSegmentSchema.parse(segment);
}

export function assertStoryboardApprovalAllowed(revision: StoryboardRevision, pendingCorrections: readonly StoryboardCorrection[] = []): void {
  if (revision.state === 'STORYBOARD_SUPERSEDED') throw new StoryboardStateError('Superseded storyboard revisions cannot be approved');
  if (pendingCorrections.some(correction => correction.status === 'PENDING')) throw new StoryboardApprovalRequiredError('Pending corrections must be resolved before approval');
  if (revision.state === 'STORYBOARD_BLOCKED') throw new StoryboardStateError('Blocked storyboard cannot be approved');
}

export function dependentSegmentIds(segments: readonly StoryboardSegment[], segmentId: string): Set<string> {
  const affected = new Set([segmentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const segment of segments) {
      if (segment.dependsOn.some(dependency => affected.has(dependency)) && !affected.has(segment.segmentId)) {
        affected.add(segment.segmentId);
        changed = true;
      }
    }
  }
  return affected;
}
