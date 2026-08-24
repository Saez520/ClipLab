import { z } from 'zod';
import { synthesisHandoffSchema } from './synthesis.js';
import { inlineReferenceSchema, narrativeConfigurationSchema } from './narrative.js';
import { publicationProfileSchema, resolvedSourceSchema, segmentValidationSchema, storyboardCorrectionSchema, storyboardSegmentSchema } from './storyboard.js';
const id = z.string().min(1); const optionalText = z.string().optional();
export const noteToScriptSchema = z.object({ opportunityId:id, originalNote:z.string().min(1), directorDecision:z.string().min(1), centralApproach:z.string().min(1), audience:optionalText, language:optionalText, targetDurationSeconds:z.number().positive().optional(), editorialWarnings:z.array(z.string()).optional(), editorialProposalId:optionalText, ...synthesisHandoffSchema.partial().shape });
export const scriptToStoryboardSchema = z.object({
  opportunityId:id,
  scriptId:id,
  authorizedScript:z.string().min(1),
  references:z.array(inlineReferenceSchema),
  configuration:narrativeConfigurationSchema,
  targetDurationSeconds:z.number().positive().optional(),
  validationStatus:z.literal('DIRECTOR_VALIDATED'),
  directorValidationId:id,
  scriptAuthorization:id
}).strict();
export const storyboardToRenderSchema = z.object({
  opportunityId: id,
  scriptId: id,
  authorizedScript: z.string().min(1),
  directorValidationId: id,
  scriptAuthorization: id,
  storyboardId: id,
  storyboardRevisionId: id,
  storyboardRevisionVersion: z.number().int().positive(),
  authorizedSegments: z.array(storyboardSegmentSchema).min(1),
  audioVisualMapping: z.array(z.object({ segmentId: id, mapping: z.string().min(1) }).strict()).min(1),
  rhythmAndPositions: z.array(z.object({ segmentId: id, position: z.number().int().nonnegative(), durationSeconds: z.number().positive(), rhythm: z.string().min(1), synchronization: z.string().min(1) }).strict()).min(1),
  visualSpecification: z.object({ aspectRatio: z.string().min(1), visualDensity: z.string().min(1), language: z.string().min(1) }).strict(),
  finalDurationSeconds: z.number().positive(),
  targetDurationSeconds: z.number().positive().optional(),
  profile: publicationProfileSchema,
  sources: z.array(resolvedSourceSchema).min(1),
  validations: z.array(segmentValidationSchema).min(1),
  corrections: z.array(storyboardCorrectionSchema),
  userApprovalId: id,
  productionAuthorization: id,
  state: z.literal('AUTHORIZED_FOR_PRODUCTION'),
  authorizationState: z.literal('AUTHORIZED_FOR_PRODUCTION').optional()
}).strict().superRefine((handoff, context) => {
  const segmentIds = handoff.authorizedSegments.map(segment => segment.segmentId);
  const mappingIds = handoff.audioVisualMapping.map(mapping => mapping.segmentId);
  const rhythmIds = handoff.rhythmAndPositions.map(item => item.segmentId);
  if (new Set(segmentIds).size !== segmentIds.length || new Set(mappingIds).size !== mappingIds.length || new Set(rhythmIds).size !== rhythmIds.length || segmentIds.length !== mappingIds.length || segmentIds.length !== rhythmIds.length || segmentIds.some(segmentId => !mappingIds.includes(segmentId) || !rhythmIds.includes(segmentId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['audioVisualMapping'], message: 'Every authorized segment requires an audiovisual mapping' });
  }
  for (const [index, segment] of handoff.authorizedSegments.entries()) {
    const mapping = handoff.audioVisualMapping.find(item => item.segmentId === segment.segmentId);
    const rhythm = handoff.rhythmAndPositions.find(item => item.segmentId === segment.segmentId);
    if (mapping && mapping.mapping !== segment.audiovisualMapping.correspondence) context.addIssue({ code: z.ZodIssueCode.custom, path: ['audioVisualMapping'], message: `Mapping does not match segment ${segment.segmentId}` });
    if (rhythm && (rhythm.position !== segment.position || rhythm.durationSeconds !== segment.durationSeconds || rhythm.rhythm !== segment.rhythm || rhythm.synchronization !== segment.synchronization)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rhythmAndPositions'], message: `Timing does not match segment ${segment.segmentId}` });
    const conditionIds = segment.technicalConditions.map(condition => condition.conditionId).sort();
    const coverageIds = segment.technicalCoverage.map(coverage => coverage.conditionId).sort();
    if (JSON.stringify(conditionIds) !== JSON.stringify(coverageIds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorizedSegments'], message: `Technical coverage does not match segment ${segment.segmentId}` });
    for (const coverage of segment.technicalCoverage) {
      const condition = segment.technicalConditions.find(candidate => candidate.conditionId === coverage.conditionId);
      if (!condition || JSON.stringify(condition) !== JSON.stringify(coverage.condition)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorizedSegments'], message: `Technical condition ${coverage.conditionId} was altered in segment ${segment.segmentId}` });
    }
    const validation = handoff.validations[index];
    if (validation && (JSON.stringify(validation.requiredConditionIds) !== JSON.stringify(segment.validation.requiredConditionIds) || JSON.stringify(validation.coveredConditionIds) !== JSON.stringify(segment.validation.coveredConditionIds) || JSON.stringify(validation.missingConditionIds) !== JSON.stringify(segment.validation.missingConditionIds) || JSON.stringify(validation.unknownConditionIds) !== JSON.stringify(segment.validation.unknownConditionIds) || JSON.stringify(validation.duplicateConditionIds) !== JSON.stringify(segment.validation.duplicateConditionIds) || JSON.stringify(validation.contradictoryConditionIds) !== JSON.stringify(segment.validation.contradictoryConditionIds))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['validations'], message: `Technical validation does not match segment ${segment.segmentId}` });
    }
  }
  if (handoff.validations.length !== segmentIds.length || handoff.sources.some(source => !segmentIds.includes(source.segmentId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validations'], message: 'Sources and validations must correspond to authorized segments' });
  }
});
export type StoryboardToRenderHandoff = z.infer<typeof storyboardToRenderSchema>;
/**
 * RENDER→FINAL handoff, strictly typed: only constructible from a SUCCEEDED
 * render (see RenderService.buildFinalHandoffDraft). A failed or incomplete
 * render can never satisfy this schema, so it can never reach FINAL.
 */
export const renderToFinalSchema = z.object({
  opportunityId: id,
  scriptOriginReference: id,
  storyboardOriginReference: id,
  productionAuthorizationReference: id,
  renderId: id,
  productionResult: z.object({ artifactPath: z.string().min(1), sha256: z.string().min(1), durationSeconds: z.number().positive(), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().int().positive() }).strict(),
  synchronizationStatus: z.literal('SYNCED'),
  knownIncidents: z.array(z.string()).optional(),
  finalAuthorizationOrReturn: z.enum(['FINAL_AUTHORIZATION', 'RETURN_TO_RENDER'])
}).strict();
export const handoffSchemas = { NOTE: noteToScriptSchema, SCRIPT: scriptToStoryboardSchema, STORYBOARD: storyboardToRenderSchema, RENDER: renderToFinalSchema } as const;
export type HandoffPayload = z.infer<typeof noteToScriptSchema> | z.infer<typeof scriptToStoryboardSchema> | z.infer<typeof storyboardToRenderSchema> | z.infer<typeof renderToFinalSchema>;
export function validateHandoff(state: keyof typeof handoffSchemas, payload: unknown): HandoffPayload { return handoffSchemas[state].parse(payload) as HandoffPayload; }
