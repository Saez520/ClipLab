import { z } from 'zod';

export const editorialResults = ['APPROVE', 'SCOPE', 'REQUEST_CONTEXT', 'DISCARD'] as const;
export type EditorialResult = typeof editorialResults[number];
export const proposalStatuses = ['PROPOSED', 'APPROVED', 'QUESTIONED'] as const;
export type ProposalStatus = typeof proposalStatuses[number];

export const curationInputSchema = z.object({
  originalNote: z.string().min(1), evidence: z.string().optional(), centralApproach: z.string().optional(),
  audience: z.enum(['TECHNICAL_HIRING_MANAGERS', 'AUTOMATION_CLIENTS', 'BOTH']).default('BOTH'),
  objective: z.enum(['DISCOVERY', 'CONVERSION']).default('DISCOVERY'), businessBridge: z.string().optional(),
  coverageCompatible: z.boolean().default(true), technicalPrecision: z.boolean().default(true),
  tooBroad: z.boolean().default(false), genericSaturated: z.boolean().default(false), differentiation: z.string().optional(),
  sourceLanguage: z.string().default('es'), language: z.string().default('es'),
  channel: z.enum(['DUAL', 'SINGLE']).default('DUAL'), channelJustification: z.string().optional(), hookNeeded: z.boolean().default(false),
  targetDurationSeconds: z.number().positive().optional(), editorialWarnings: z.array(z.string()).default([])
});
export type CurationInput = z.infer<typeof curationInputSchema>;
export const developerResponseSchema = z.object({ actor: z.string().min(1), reason: z.string().optional(), overrideProofOfConcept: z.boolean().default(false) });
export type DeveloperResponse = z.infer<typeof developerResponseSchema>;
export type EditorialProposal = CurationInput & { result: EditorialResult; justification: string; gaps: string[]; warnings: string[]; proposalHook?: string; director: string };

export function evaluateCuration(input: CurationInput, director = 'director'): EditorialProposal {
  const gaps: string[] = []; const warnings = [...input.editorialWarnings];
  let result: EditorialResult;
  if (!input.evidence?.trim()) { result = 'REQUEST_CONTEXT'; gaps.push('Falta evidencia o experiencia propia concreta y por eso no puede aprobarse como experiencia probada.'); }
  else if (input.genericSaturated && !input.differentiation?.trim()) { result = 'DISCARD'; gaps.push('El tema es genérico o saturado y no presenta diferenciación propia suficiente.'); }
  else if (input.tooBroad) { result = 'SCOPE'; gaps.push('El tema requiere dividirse en varias piezas con enfoques concretos.'); }
  else { result = 'APPROVE'; if (input.audience !== 'BOTH' && !input.businessBridge) warnings.push('Alcance unilateral: la propuesta conecta principalmente con una audiencia.'); if (input.audience === 'BOTH' && !input.businessBridge) warnings.push('Alcance unilateral: falta puente de negocio para clientes de automatización.'); }
  if (input.channel === 'SINGLE' && !input.channelJustification) gaps.push('El canal único requiere justificación del Director.');
  if (input.sourceLanguage !== 'es') warnings.push('La fuente se adapta al español sin descartar por su idioma de origen.');
  if (!input.coverageCompatible) gaps.push(`La cobertura no parece compatible con el objetivo de ${input.objective}; la duración concreta queda para storyboard.`);
  return { ...input, result, justification: `Decisión ${result}: ${gaps.length ? gaps.join(' ') : 'evidencia propia, enfoque, audiencia y objetivo identificables.'}`, gaps, warnings, proposalHook: input.hookNeeded ? 'Proponer hook introductorio complementario de bajo costo.' : undefined, director };
}
