import { z } from 'zod';
import { NarrativeStateError, ValidationError } from './errors.js';

const id = z.string().min(1);

export const NARRATIVE_STATES = [
  'CONFIGURATION_PENDING_USER_APPROVAL',
  'READY_TO_GENERATE',
  'DRAFT',
  'BLOCKED',
  'READY_FOR_DIRECTOR_VALIDATION',
  'DIRECTOR_VALIDATED'
] as const;
export type NarrativeState = typeof NARRATIVE_STATES[number];

export const NARRATIVE_TRANSITIONS = [
  { from: 'DRAFT', to: 'BLOCKED' },
  { from: 'DRAFT', to: 'READY_FOR_DIRECTOR_VALIDATION' },
  { from: 'READY_FOR_DIRECTOR_VALIDATION', to: 'DIRECTOR_VALIDATED' }
] as const;

export function assertNarrativeTransition(from: NarrativeState, to: NarrativeState): void {
  if (!NARRATIVE_TRANSITIONS.some(transition => transition.from === from && transition.to === to)) {
    throw new NarrativeStateError(`Narrative transition ${from} to ${to} is not allowed`);
  }
}

const configurationFields = {
  audience: z.string().min(1),
  tone: z.string().min(1),
  depth: z.string().min(1),
  voice: z.string().min(1),
  style: z.string().min(1),
  targetDurationSeconds: z.number().positive().optional(),
  userApproved: z.literal(true),
} as const;

const persistedConfigurationFields = {
  opportunityId: id,
  configurationId: id,
  ...configurationFields,
  approvedBy: id,
  approvedAt: z.string().min(1)
} as const;

export const narrativeConfigurationProposalSchema = z.object({
  audience: z.string().min(1),
  tone: z.string().min(1),
  depth: z.string().min(1),
  voice: z.string().min(1),
  style: z.string().min(1),
  targetDurationSeconds: z.number().positive().optional()
}).strict();
export type NarrativeConfigurationProposal = z.infer<typeof narrativeConfigurationProposalSchema>;

export const narrativeConfigurationSchema = z.object(configurationFields).strict();
export type NarrativeConfiguration = z.infer<typeof narrativeConfigurationSchema>;
export const persistedNarrativeConfigurationSchema = z.object(persistedConfigurationFields).strict();
export type PersistedNarrativeConfiguration = z.infer<typeof persistedNarrativeConfigurationSchema>;

export const inlineReferenceSchema = z.object({
  raw: z.string().min(1),
  path: z.string().min(1),
  locator: z.enum(['lines', 'section']),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  section: z.string().min(1).optional()
}).strict();
export type InlineReference = z.infer<typeof inlineReferenceSchema>;

export const narrativeScriptSchema = z.object({
  opportunityId: id,
  scriptId: id,
  configurationId: id,
  state: z.enum(NARRATIVE_STATES),
  narrativeText: z.string().min(1),
  references: z.array(inlineReferenceSchema),
  targetDurationSeconds: z.number().positive().optional(),
  sources: z.record(z.string()).default({}),
  blockedReason: z.string().min(1).optional(),
  blockedRecipient: z.string().min(1).optional(),
  directorValidationId: id.optional(),
  scriptAuthorization: id.optional(),
  createdAt: z.string().min(1)
}).strict().superRefine((script, context) => {
  if (script.state === 'BLOCKED' && !script.blockedReason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['blockedReason'], message: 'Blocked narratives require a reason' });
  if (script.state === 'DIRECTOR_VALIDATED' && !script.directorValidationId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['directorValidationId'], message: 'Director validation is required' });
  if (script.state === 'DIRECTOR_VALIDATED' && !script.scriptAuthorization) context.addIssue({ code: z.ZodIssueCode.custom, path: ['scriptAuthorization'], message: 'Script authorization is required' });
});
export type NarrativeScript = z.infer<typeof narrativeScriptSchema>;

export type ReferenceSources = Record<string, string>;

const referenceToken = /\[([^\]\n]+)\]/g;
const relativePath = /^(?!\/)(?![A-Za-z]:)(?![a-z]+:\/\/)[^:]+$/i;

function sourceFor(sources: ReferenceSources, path: string): string {
  const source = sources[path];
  if (typeof source !== 'string') throw new ValidationError(`Reference source cannot be resolved: ${path}`);
  return source;
}

function validateLineRange(path: string, locator: string, source: string): Pick<InlineReference, 'locator' | 'startLine' | 'endLine' | 'section'> {
  const match = /^(\d+)(?:-(\d+))?$/.exec(locator);
  if (!match) {
    if (!/\.md$/i.test(path)) throw new ValidationError(`Only Markdown documents support section references: ${path}`);
    return { locator: 'section', section: locator };
  }
  const startLine = Number(match[1]);
  const endLine = Number(match[2] ?? match[1]);
  if (endLine < startLine || source.split(/\r?\n/).length < endLine) {
    throw new ValidationError(`Reference line range cannot be resolved: ${path}:${locator}`);
  }
  return { locator: 'lines', startLine, endLine };
}

function validateSection(path: string, locator: string, source: string): Pick<InlineReference, 'locator' | 'section'> {
  const headings = source.split(/\r?\n/)
    .filter(line => /^\s*#{1,6}\s+/.test(line))
    .map(line => line.replace(/^\s*#{1,6}\s+/, '').trim().toLowerCase());
  const matches = headings.filter(heading => heading === locator.trim().toLowerCase());
  if (matches.length !== 1) {
    throw new ValidationError(`Reference section cannot be resolved: ${path}:${locator}`);
  }
  return { locator: 'section', section: locator };
}

export function parseInlineReferences(text: string, sources: ReferenceSources = {}): InlineReference[] {
  if (!text.trim()) throw new ValidationError('Narrative text is required');
  const references: InlineReference[] = [];
  for (const match of text.matchAll(referenceToken)) {
    const raw = match[0];
    const content = match[1];
    const separator = content.lastIndexOf(':');
    if (separator <= 0) throw new ValidationError(`Invalid inline reference: ${raw}`);
    const path = content.slice(0, separator);
    const locator = content.slice(separator + 1);
    if (!relativePath.test(path) || !locator.trim()) throw new ValidationError(`Invalid inline reference: ${raw}`);
    if (!/^(\d+)(?:-(\d+))?$/.test(locator) && !/\.md$/i.test(path)) throw new ValidationError(`Only Markdown documents support section references: ${path}`);
    const source = sourceFor(sources, path);
    const resolved = /^(\d+)(?:-(\d+))?$/.test(locator)
      ? validateLineRange(path, locator, source)
      : validateSection(path, locator, source);
    references.push({ raw, path, ...resolved });
  }
  const withoutReferences = text.replace(referenceToken, '');
  if (withoutReferences.includes('[') || withoutReferences.includes(']')) throw new ValidationError('Invalid inline reference syntax');
  return references;
}

export function textWithoutReferences(text: string): string {
  return text.replace(referenceToken, '');
}

export const locutionText = textWithoutReferences;
export const subtitleText = textWithoutReferences;
export const durationText = textWithoutReferences;

export function assertApprovedConfiguration(configuration: unknown): NarrativeConfiguration {
  return narrativeConfigurationSchema.parse(configuration);
}
