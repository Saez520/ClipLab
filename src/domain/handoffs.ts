import { z } from 'zod';
import { synthesisHandoffSchema } from './synthesis.js';
import { inlineReferenceSchema, narrativeConfigurationSchema } from './narrative.js';
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
export const storyboardToRenderSchema = z.object({ opportunityId:id, authorizedSegments:z.array(z.unknown()).min(1), audioVisualMapping:z.array(z.unknown()).min(1), rhythmAndPositions:z.string().min(1), knownOutputRequirements:z.array(z.string()).optional(), productionAuthorization:z.string().min(1) });
export const renderToFinalSchema = z.object({ opportunityId:id, scriptOriginReference:id, storyboardOriginReference:id, productionResult:z.string().min(1), synchronizationStatus:z.string().min(1), knownIncidents:z.array(z.string()).optional(), finalAuthorizationOrReturn:z.string().min(1) });
export const handoffSchemas = { NOTE: noteToScriptSchema, SCRIPT: scriptToStoryboardSchema, STORYBOARD: storyboardToRenderSchema, RENDER: renderToFinalSchema } as const;
export type HandoffPayload = z.infer<typeof noteToScriptSchema> | z.infer<typeof scriptToStoryboardSchema> | z.infer<typeof storyboardToRenderSchema> | z.infer<typeof renderToFinalSchema>;
export function validateHandoff(state: keyof typeof handoffSchemas, payload: unknown): HandoffPayload { return handoffSchemas[state].parse(payload) as HandoffPayload; }
