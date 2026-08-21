import { z } from 'zod';

const id = z.string().min(1);
const text = z.string().min(1);

export const synthesisSourceSchema = z.object({
  title: text,
  locator: text,
  authority: z.enum(['PRIMARY', 'AUTHORITATIVE', 'CITABLE', 'RECENT_CONTROVERSIAL']),
  note: z.string().optional(),
}).strict();

export const contextEntrySchema = z.object({
  kind: z.enum(['CURRENT_SESSION', 'WORKING_DECISION', 'HISTORICAL']),
  content: text,
}).strict();

export const synthesisRequestSchema = z.object({
  opportunityId: id,
  sessionId: id,
  actor: id,
  recipient: z.literal('DIRECTOR'),
  query: text,
  context: z.array(contextEntrySchema).default([]),
}).strict();

export const delegatedQuerySchema = synthesisRequestSchema;

export const synthesisResultSchema = z.object({
  queryId: id,
  conclusion: text,
  relevantEvidence: z.array(text),
  uncertainties: z.array(text),
  recommendation: text,
  alternatives: z.array(text).optional(),
  risks: z.array(text).optional(),
  sources: z.array(synthesisSourceSchema).optional(),
  partial: z.boolean().default(false),
  actionRequired: text.optional(),
}).strict();

export const synthesisHandoffSchema = z.object({
  relevantSynthesis: text,
  sourcesToPreserve: z.array(text),
  acceptedGaps: z.array(text),
}).strict();

export type ContextEntry = z.infer<typeof contextEntrySchema>;
export type SynthesisRequest = z.infer<typeof synthesisRequestSchema>;
export type DelegatedQuery = z.infer<typeof delegatedQuerySchema>;
export type SynthesisResult = z.infer<typeof synthesisResultSchema>;
export type SynthesisHandoff = z.infer<typeof synthesisHandoffSchema>;

export function projectSynthesisToHandoff(result: SynthesisResult): SynthesisHandoff {
  const sourceNotes = (result.sources ?? []).map(source => `${source.title}: ${source.locator}`);
  return {
    relevantSynthesis: [result.conclusion, result.recommendation, ...result.relevantEvidence].join('\n'),
    sourcesToPreserve: sourceNotes,
    acceptedGaps: [...result.uncertainties, ...(result.actionRequired ? [result.actionRequired] : [])],
  };
}
