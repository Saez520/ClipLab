import { createHash } from 'node:crypto';
import { z } from 'zod';

export const TECHNICAL_CONDITION_TYPES = [
  'resolution',
  'frameRate',
  'refreshRate',
  'aspectRatio',
  'displayMode'
] as const;
export type TechnicalConditionType = typeof TECHNICAL_CONDITION_TYPES[number];

export const TECHNICAL_EXTRACTION_STATES = ['COMPLETE', 'AMBIGUOUS'] as const;
export type TechnicalExtractionState = typeof TECHNICAL_EXTRACTION_STATES[number];

export const technicalCanonicalValueSchema = z.object({
  value: z.union([z.string().min(1), z.number().finite()]),
  unit: z.string().min(1).optional(),
  profile: z.enum(['UHD', 'DCI']).optional()
}).strict();
export type TechnicalCanonicalValue = z.infer<typeof technicalCanonicalValueSchema>;

export const technicalEvidenceSchema = z.object({
  path: z.string().min(1),
  locator: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  line: z.number().int().positive()
}).strict();
export type TechnicalEvidence = z.infer<typeof technicalEvidenceSchema>;

export const technicalConditionSchema = z.object({
  conditionId: z.string().min(1),
  type: z.enum(TECHNICAL_CONDITION_TYPES),
  canonicalValue: technicalCanonicalValueSchema,
  originalText: z.string().min(1),
  evidence: technicalEvidenceSchema,
  scope: z.enum(['segment', 'global']),
  extractionState: z.enum(TECHNICAL_EXTRACTION_STATES)
}).strict();
export type TechnicalCondition = z.infer<typeof technicalConditionSchema>;

export const technicalExtractionSchema = z.object({
  state: z.enum(TECHNICAL_EXTRACTION_STATES),
  conditions: z.array(technicalConditionSchema),
  ambiguousExpressions: z.array(z.string().min(1))
}).strict();
export type TechnicalExtraction = z.infer<typeof technicalExtractionSchema>;

export type TechnicalSource = {
  path: string;
  locator: string;
  content: string;
  scope?: 'segment' | 'global';
};

type Match = {
  type: TechnicalConditionType;
  originalText: string;
  canonicalValue: TechnicalCanonicalValue;
  start: number;
  end: number;
};

const boundaryBefore = String.raw`(?<![\p{L}\p{N}])`;
const boundaryAfter = String.raw`(?![\p{L}\p{N}])`;

function canonicalNumber(value: string): number {
  return Number(value.replace(',', '.'));
}

function canonicalizeMatch(type: TechnicalConditionType, value: string, suffix?: string): TechnicalCanonicalValue {
  if (type === 'resolution') {
    const normalized = value.toUpperCase().replace(/\s+/g, '');
    if (normalized === 'FULLHD' || normalized === 'FULL-HD') return { value: 1080, unit: 'p' };
    if (normalized === 'HD') return { value: 720, unit: 'p' };
    return { value: Number(normalized.replace(/P$/i, '')), unit: 'p', ...(suffix ? { profile: suffix as 'UHD' | 'DCI' } : {}) };
  }
  if (type === 'frameRate') return { value: canonicalNumber(value), unit: 'fps' };
  if (type === 'refreshRate') return { value: canonicalNumber(value), unit: 'Hz' };
  if (type === 'aspectRatio') return { value: value.replace(/\s+/g, ''), unit: 'ratio' };
  return { value: value.toUpperCase(), unit: 'mode' };
}

export function canonicalizeTechnicalValue(type: TechnicalConditionType, value: string): TechnicalCanonicalValue {
  const normalized = value.trim();
  if (type === 'resolution') {
    const profile = /\bUHD\b/i.test(normalized) ? 'UHD' : /\bDCI\b/i.test(normalized) ? 'DCI' : undefined;
    const number = normalized.match(/\d+(?:\.\d+)?/u)?.[0];
    if (number) return canonicalizeMatch(type, `${number}p`, profile);
  }
  if (type === 'frameRate') return canonicalizeMatch(type, normalized.replace(/\s*fps$/i, ''), undefined);
  if (type === 'refreshRate') return canonicalizeMatch(type, normalized.replace(/\s*hz$/i, ''), undefined);
  if (type === 'aspectRatio') return canonicalizeMatch(type, normalized, undefined);
  return canonicalizeMatch(type, normalized, undefined);
}

function conditionId(source: TechnicalSource, match: Match): string {
  const identity = [source.path, source.locator, match.start, match.type, JSON.stringify(match.canonicalValue)].join('|');
  return `tc_${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function lineAt(content: string, position: number): number {
  return content.slice(0, position).split(/\r?\n/u).length;
}

function matchesFor(content: string): { matches: Match[]; ambiguous: string[] } {
  const matches: Match[] = [];
  const ambiguous: string[] = [];
  const add = (expression: RegExp, build: (match: RegExpExecArray) => Match) => {
    for (const match of content.matchAll(expression)) {
      if (match.index === undefined) continue;
      matches.push(build(match));
    }
  };

  add(new RegExp(`${boundaryBefore}(\\d+)\\s*p${boundaryAfter}`, 'giu'), match => ({
    type: 'resolution', originalText: match[0], canonicalValue: canonicalizeMatch('resolution', match[1], undefined), start: match.index!, end: match.index! + match[0].length
  }));
  add(new RegExp(`${boundaryBefore}(?:full[- ]?hd|hd)${boundaryAfter}`, 'giu'), match => ({
    type: 'resolution', originalText: match[0], canonicalValue: canonicalizeMatch('resolution', match[0]), start: match.index!, end: match.index! + match[0].length
  }));
  add(new RegExp(`${boundaryBefore}(\\d+(?:[.,]\\d+)?)\\s*fps${boundaryAfter}`, 'giu'), match => ({
    type: 'frameRate', originalText: match[0], canonicalValue: canonicalizeMatch('frameRate', match[1]), start: match.index!, end: match.index! + match[0].length
  }));
  add(new RegExp(`${boundaryBefore}(\\d+(?:[.,]\\d+)?)\\s*hz${boundaryAfter}`, 'giu'), match => ({
    type: 'refreshRate', originalText: match[0], canonicalValue: canonicalizeMatch('refreshRate', match[1]), start: match.index!, end: match.index! + match[0].length
  }));
  add(new RegExp(`${boundaryBefore}(\\d+)\\s*:\\s*(\\d+)${boundaryAfter}`, 'gu'), match => ({
    type: 'aspectRatio', originalText: match[0], canonicalValue: canonicalizeMatch('aspectRatio', `${match[1]}:${match[2]}`), start: match.index!, end: match.index! + match[0].length
  }));
  add(new RegExp(`${boundaryBefore}(VR|3D)${boundaryAfter}`, 'giu'), match => ({
    type: 'displayMode', originalText: match[0], canonicalValue: canonicalizeMatch('displayMode', match[1]), start: match.index!, end: match.index! + match[0].length
  }));

  for (const match of content.matchAll(new RegExp(`${boundaryBefore}4K${boundaryAfter}`, 'giu'))) {
    if (match.index === undefined) continue;
    const context = content.slice(Math.max(0, match.index - 12), Math.min(content.length, match.index + match[0].length + 12));
    const profile = /\bUHD\b/i.test(context) ? 'UHD' : /\bDCI\b/i.test(context) ? 'DCI' : undefined;
    if (!profile) {
      ambiguous.push(`Ambiguous resolution expression: ${match[0]}`);
      continue;
    }
    matches.push({ type: 'resolution', originalText: match[0], canonicalValue: canonicalizeMatch('resolution', match[0], profile), start: match.index, end: match.index + match[0].length });
  }
  for (const match of content.matchAll(new RegExp(`${boundaryBefore}(\\d+(?:[.,]\\d+)?)\\s*[–—-]\\s*(\\d+(?:[.,]\\d+)?)\\s*fps${boundaryAfter}`, 'giu'))) {
    if (match.index !== undefined) ambiguous.push(`Ambiguous frame-rate range: ${match[0]}`);
  }
  return { matches, ambiguous };
}

export function extractTechnicalConditions(source: TechnicalSource | string, context?: Omit<TechnicalSource, 'content'>): TechnicalExtraction {
  const resolved: TechnicalSource = typeof source === 'string'
    ? { path: context?.path ?? 'narrative', locator: context?.locator ?? 'narrative', content: source, scope: context?.scope }
    : source;
  const { matches, ambiguous: ambiguousExpressions } = matchesFor(resolved.content);
  const conditions = matches
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map(match => technicalConditionSchema.parse({
      conditionId: conditionId(resolved, match),
      type: match.type,
      canonicalValue: match.canonicalValue,
      originalText: match.originalText,
      evidence: { path: resolved.path, locator: resolved.locator, start: match.start, end: match.end, line: lineAt(resolved.content, match.start) },
      scope: resolved.scope ?? 'segment',
      extractionState: 'COMPLETE'
    }));
  return technicalExtractionSchema.parse({ state: ambiguousExpressions.length ? 'AMBIGUOUS' : 'COMPLETE', conditions, ambiguousExpressions });
}

export function technicalConditionKey(condition: Pick<TechnicalCondition, 'type' | 'canonicalValue'>): string {
  return `${condition.type}:${JSON.stringify(condition.canonicalValue)}`;
}

export function compareTechnicalConditions(required: readonly TechnicalCondition[], coveredIds: readonly string[]) {
  const requiredIds = new Set(required.map(condition => condition.conditionId));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const id of coveredIds) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
    if (!requiredIds.has(id)) unknown.push(id);
  }
  const missing = required.filter(condition => !seen.has(condition.conditionId)).map(condition => condition.conditionId);
  return { requiredIds: [...requiredIds], coveredIds: [...seen], missingIds: missing, unknownIds: [...new Set(unknown)], duplicateIds: [...new Set(duplicates)] };
}

export function technicalValuesEqual(a: TechnicalCondition, b: TechnicalCondition): boolean {
  return technicalConditionKey(a) === technicalConditionKey(b);
}
