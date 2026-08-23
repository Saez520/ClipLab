import { z, ZodError } from 'zod';
import { storyboardToRenderSchema, type StoryboardToRenderHandoff } from '../domain/handoffs.js';
import { AuthorizationRequiredError, NotFoundError, SourceUnresolvedError, StoryboardApprovalRequiredError, StoryboardBlockedError, StoryboardStateError, ValidationError } from '../domain/errors.js';
import { finalDuration, dependentSegmentIds, normalizePublicationProfile, assertStoryboardApprovalAllowed, requiresExplicitApproval, storyboardCorrectionSchema, storyboardRevisionSchema, storyboardSegmentProposalSchema, validateStoryboardSegment, type StoryboardCorrection, type StoryboardRevision, type StoryboardSegment, type StoryboardSegmentProposal } from '../domain/storyboard.js';
import { textWithoutReferences, type InlineReference, type NarrativeScript } from '../domain/narrative.js';
import { compareTechnicalConditions, extractTechnicalConditions, technicalConditionKey, type TechnicalCondition } from '../domain/technical-conditions.js';
import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { StoryboardRepository } from '../infrastructure/repositories/storyboard-repository.js';

const actorSchema = z.string().min(1);
const createInputSchema = z.object({ actor: actorSchema.optional(), profile: z.record(z.unknown()).optional(), segments: z.array(z.record(z.unknown())).min(1) }).strict();
const approvalInputSchema = z.object({ actor: actorSchema, storyboardRevisionId: z.string().min(1) }).strict();
const correctionInputSchema = z.object({ actor: actorSchema, segmentId: z.string().min(1), expectedAdjustment: z.string().min(1), editorialChange: z.boolean().default(false) }).strict();
const revalidateInputSchema = z.object({ actor: actorSchema, segments: z.array(z.record(z.unknown())).optional() }).strict();

export class StoryboardService {
  constructor(private storyboard: StoryboardRepository, private narrative: NarrativeRepository, private pipeline: PipelineRepository) {}

  create(opportunityId: string, input: unknown) {
    const body = createInputSchema.parse(input);
    const actor = body.actor ?? 'storyboard';
    let script: NarrativeScript;
    try {
      script = this.narrative.getScript(opportunityId) as NarrativeScript;
    } catch (error) {
      if (error instanceof NotFoundError) throw new StoryboardBlockedError('A persisted narrative script is required before creating a storyboard', { recipient: 'DIRECTOR', scriptState: 'MISSING' });
      throw error;
    }
    if (script.state !== 'DIRECTOR_VALIDATED' || !script.directorValidationId || !script.scriptAuthorization) {
      throw new StoryboardBlockedError('Only a Director-validated script can create a storyboard', { recipient: 'DIRECTOR', scriptState: script.state });
    }
    const configuration = this.narrative.getConfiguration(opportunityId, script.configurationId) as any;
    const profile = normalizePublicationProfile(body.profile);
    const segments = this.parseSegments(body.segments, script);
    const current = this.tryGet(opportunityId);
    const storyboardId = current?.storyboardId ?? `${opportunityId}-storyboard`;
    const version = (current?.currentRevisionVersion ?? 0) + 1;
    const revision = this.buildRevision({
      opportunityId,
      storyboardId,
      version,
      scriptId: script.scriptId,
      directorValidationId: script.directorValidationId,
      scriptAuthorization: script.scriptAuthorization,
      profile,
      segments,
      targetDurationSeconds: script.targetDurationSeconds ?? configuration.payload.targetDurationSeconds,
      state: 'STORYBOARD_READY_FOR_USER_APPROVAL',
      corrections: []
    });
    if (current) this.storyboard.markSuperseded(opportunityId, current.currentRevisionId, actor);
    return this.storyboard.createRevision(revision, actor);
  }

  get(opportunityId: string) { return this.storyboard.getRevision(opportunityId); }
  lineage(opportunityId: string) { return this.storyboard.history(opportunityId); }

  approve(opportunityId: string, input: unknown) {
    const body = approvalInputSchema.parse(input);
    const current = this.storyboard.getRevision(opportunityId);
    if (current.storyboardRevisionId !== body.storyboardRevisionId) throw new StoryboardStateError('Only the current storyboard revision can be approved');
    if (current.state !== 'STORYBOARD_READY_FOR_USER_APPROVAL') throw new StoryboardStateError('Only a storyboard ready for user approval can be approved');
    assertStoryboardApprovalAllowed(current, this.storyboard.pendingCorrections(opportunityId, current.storyboardRevisionId));
    return this.storyboard.approve(opportunityId, current.storyboardId, current.storyboardRevisionId, body.actor, `${opportunityId}-approval-${Date.now()}`);
  }

  requestCorrection(opportunityId: string, input: unknown) {
    const body = correctionInputSchema.parse(input);
    const current = this.storyboard.getRevision(opportunityId);
    if (current.state === 'STORYBOARD_BLOCKED' && current.blockedRecipient === 'DIRECTOR') {
      throw new StoryboardBlockedError('Director validation is required before requesting another storyboard correction', { recipient: 'DIRECTOR', blockedReason: current.blockedReason });
    }
    const affected = dependentSegmentIds(current.segments, body.segmentId);
    if (!current.segments.some(segment => segment.segmentId === body.segmentId)) throw new ValidationError('Correction segment does not exist');
    const correction = storyboardCorrectionSchema.parse({
      correctionId: `${opportunityId}-correction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      segmentId: body.segmentId,
      expectedAdjustment: body.expectedAdjustment,
      requestedBy: body.actor,
      requestedAt: new Date().toISOString(),
      status: 'PENDING',
      editorialChange: body.editorialChange,
      recipient: body.editorialChange ? 'DIRECTOR' : 'STORYBOARD'
    });
    const segments = current.segments.map(segment => {
      if (!affected.has(segment.segmentId)) return segment;
      if (segment.segmentId !== body.segmentId) {
        return validateStoryboardSegment({
          ...segment,
          version: segment.version + 1,
          reviewNote: `Revalidated because ${body.segmentId} changed`,
          position: segment.position
        });
      }
      const adjusted = body.expectedAdjustment;
      return validateStoryboardSegment({
        ...segment,
        version: segment.version + 1,
        visualRepresentation: adjusted,
        audiovisualMapping: { ...segment.audiovisualMapping, visual: adjusted },
        validation: { ...segment.validation, editorialChange: false, reasons: [] },
        position: segment.position,
        reviewNote: undefined
      });
    });
    const next = this.buildRevision({
      ...current,
      version: current.version + 1,
      storyboardRevisionId: `${current.storyboardId}-revision-${current.version + 1}`,
      segments,
      finalDurationSeconds: finalDuration(segments),
      corrections: [...current.corrections, correction],
      state: body.editorialChange ? 'STORYBOARD_BLOCKED' : 'STORYBOARD_CORRECTION_REQUESTED',
      blockedReason: body.editorialChange ? 'Correction changes editorial text or decision' : undefined,
      blockedRecipient: body.editorialChange ? 'DIRECTOR' : undefined
    });
    return this.storyboard.transaction(() => {
      if (current.state !== 'STORYBOARD_BLOCKED') this.storyboard.updateRevisionState(opportunityId, current.storyboardRevisionId, 'STORYBOARD_CORRECTION_REQUESTED', body.actor);
      this.storyboard.markSuperseded(opportunityId, current.storyboardRevisionId, body.actor);
      this.pipeline.invalidateAuthorization(opportunityId, 'STORYBOARD', 'STORYBOARD');
      const created = this.storyboard.createRevision(next, body.actor);
      return { revision: created, affectedSegmentIds: [...affected], correction };
    });
  }

  revalidate(opportunityId: string, input: unknown) {
    const body = revalidateInputSchema.parse(input);
    const current = this.storyboard.getRevision(opportunityId);
    if (current.state === 'STORYBOARD_BLOCKED') {
      const recipient = current.blockedRecipient ?? 'STORYBOARD';
      throw new StoryboardBlockedError(
        recipient === 'DIRECTOR' ? 'Director validation is required before revalidating an editorial storyboard correction' : 'A blocked storyboard requires a new correction before revalidation',
        { recipient, blockedReason: current.blockedReason }
      );
    }
    const script = this.narrative.getScript(opportunityId, current.scriptId) as NarrativeScript;
    let segments: StoryboardSegment[];
    try {
      segments = this.parseSegments(body.segments ?? current.segments.map(segment => this.segmentToProposal(segment)), script);
    } catch (error) {
      if (!(error instanceof StoryboardBlockedError)) throw error;
      const blockedRevision = this.buildRevision({
        ...current,
        version: current.version + 1,
        storyboardRevisionId: `${current.storyboardId}-revision-${current.version + 1}`,
        state: 'STORYBOARD_BLOCKED',
        blockedReason: error.message,
        blockedRecipient: 'STORYBOARD'
      });
      this.storyboard.transaction(() => {
        this.storyboard.markSuperseded(opportunityId, current.storyboardRevisionId, body.actor);
        this.pipeline.invalidateAuthorization(opportunityId, 'STORYBOARD', 'STORYBOARD');
        this.storyboard.createRevision(blockedRevision, body.actor);
      });
      throw new StoryboardBlockedError(error.message, { recipient: 'STORYBOARD', blockedReason: error.message, ...(error.details as Record<string, unknown> ?? {}) });
    }
    const revision = this.buildRevision({ ...current, version: current.version + 1, storyboardRevisionId: `${current.storyboardId}-revision-${current.version + 1}`, segments, corrections: current.corrections.map(correction => ({ ...correction, status: 'APPLIED' })), state: 'STORYBOARD_READY_FOR_USER_APPROVAL' });
    return this.storyboard.transaction(() => {
      this.storyboard.markSuperseded(opportunityId, current.storyboardRevisionId, body.actor);
      this.storyboard.resolveCorrections(opportunityId);
      return this.storyboard.createRevision(revision, body.actor);
    });
  }

  block(opportunityId: string, input: unknown) {
    const body = z.object({ actor: actorSchema, reason: z.string().min(1), recipient: z.string().min(1).optional() }).strict().parse(input);
    const current = this.storyboard.getRevision(opportunityId);
    return this.storyboard.updateRevisionState(opportunityId, current.storyboardRevisionId, 'STORYBOARD_BLOCKED', body.actor, body.reason, body.recipient);
  }

  handoff(opportunityId: string): StoryboardToRenderHandoff {
    const revision = this.storyboard.getRevision(opportunityId);
    const approval = this.storyboard.approval(opportunityId, revision.storyboardRevisionId);
    if (requiresExplicitApproval(revision.finalDurationSeconds) && !approval) {
      throw new StoryboardApprovalRequiredError('A storyboard over 90 seconds requires explicit user approval before handoff');
    }
    if (revision.state !== 'STORYBOARD_USER_APPROVED') throw new StoryboardApprovalRequiredError('The current storyboard revision has not been approved by the user');
    if (!approval) throw new StoryboardApprovalRequiredError();
    if (this.storyboard.pendingCorrections(opportunityId).length) throw new StoryboardBlockedError('A pending storyboard correction blocks the render handoff');
    const authorization = this.pipeline.authorization(opportunityId, 'STORYBOARD', 'STORYBOARD');
    if (!authorization) throw new AuthorizationRequiredError('A persisted STORYBOARD authorization is required before handoff');
    const script = this.narrative.getScript(opportunityId, revision.scriptId) as any;
    const payload = {
      opportunityId,
      scriptId: revision.scriptId,
      authorizedScript: script.narrativeText,
      directorValidationId: revision.directorValidationId,
      scriptAuthorization: revision.scriptAuthorization,
      storyboardId: revision.storyboardId,
      storyboardRevisionId: revision.storyboardRevisionId,
      storyboardRevisionVersion: revision.version,
      authorizedSegments: revision.segments,
      audioVisualMapping: revision.segments.map(segment => ({ segmentId: segment.segmentId, mapping: segment.audiovisualMapping.correspondence })),
      rhythmAndPositions: revision.segments.map(segment => ({ segmentId: segment.segmentId, position: segment.position, durationSeconds: segment.durationSeconds, rhythm: segment.rhythm, synchronization: segment.synchronization })),
      visualSpecification: { aspectRatio: revision.profile.aspectRatio, visualDensity: revision.profile.visualDensity, language: revision.profile.language },
      finalDurationSeconds: revision.finalDurationSeconds,
      targetDurationSeconds: revision.targetDurationSeconds,
      profile: revision.profile,
      sources: revision.sources,
      validations: revision.validations,
      corrections: revision.corrections,
      userApprovalId: approval.approval_id,
      productionAuthorization: String(authorization.id),
      state: 'AUTHORIZED_FOR_PRODUCTION' as const,
      authorizationState: 'AUTHORIZED_FOR_PRODUCTION' as const
    };
    return storyboardToRenderSchema.parse(payload);
  }

  validateForPipeline(opportunityId: string, payload: unknown) {
    const parsed = storyboardToRenderSchema.parse(payload);
    const current = this.handoff(opportunityId);
    if (JSON.stringify(parsed) !== JSON.stringify(current)) throw new AuthorizationRequiredError('Storyboard handoff does not match the current approved revision');
    return parsed;
  }

  private parseSegments(input: unknown[], script: NarrativeScript): StoryboardSegment[] {
    try {
      const proposals = input.map(value => storyboardSegmentProposalSchema.parse(value));
      const scriptText = textWithoutReferences(script.narrativeText);
      const references = new Map(script.references.map(reference => [referenceKey(reference), reference]));
      const ranges = proposals.map(proposal => ({ start: proposal.narrativeStart, end: proposal.narrativeEnd, segmentId: proposal.segmentId }));
      for (const range of ranges) {
        if (range.end > scriptText.length) {
          throw new StoryboardBlockedError(`Narrative range is outside the persisted script for segment ${range.segmentId}`, { segmentId: range.segmentId, narrativeStart: range.start, narrativeEnd: range.end });
        }
      }
      const orderedRanges = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
      for (let index = 1; index < orderedRanges.length; index += 1) {
        if (orderedRanges[index - 1].end > orderedRanges[index].start || (orderedRanges[index - 1].start === orderedRanges[index].start && orderedRanges[index - 1].end === orderedRanges[index].end)) {
          throw new StoryboardBlockedError(`Narrative ranges overlap or repeat at segment ${orderedRanges[index].segmentId}`, { segmentId: orderedRanges[index].segmentId, narrativeStart: orderedRanges[index].start, narrativeEnd: orderedRanges[index].end });
        }
      }
      const segments = proposals.map((proposal, index) => {
        if (proposal.narrativeEnd > scriptText.length || scriptText.slice(proposal.narrativeStart, proposal.narrativeEnd) !== proposal.narrativeSpan) {
          throw new StoryboardBlockedError(`Narrative span does not match its exact persisted range for segment ${proposal.segmentId}`, { segmentId: proposal.segmentId, narrativeStart: proposal.narrativeStart, narrativeEnd: proposal.narrativeEnd, narrativeSpan: proposal.narrativeSpan });
        }
        const resolvedSources = proposal.sourceReferences.map(source => {
          if (source.segmentId !== proposal.segmentId) {
            throw new SourceUnresolvedError(`Storyboard source ${source.path}:${source.locator} belongs to another segment`, { segmentId: proposal.segmentId });
          }
          const reference = references.get(`${source.path}:${source.locator}`) ?? references.get(`${source.path}:${canonicalLocatorFromInput(source.locator)}`);
          if (!reference) throw new SourceUnresolvedError(`Reference source cannot be resolved: ${source.path}:${source.locator}`);
          const key = referenceKey(reference);
          const content = resolvePersistedSource(script, reference);
          return { sourceId: `${script.scriptId}:${key}`, path: reference.path, locator: canonicalLocator(reference), content, summary: content, segmentId: proposal.segmentId };
        });
        if (!resolvedSources.length) throw new SourceUnresolvedError(`Storyboard segment has no resolved sources: ${proposal.segmentId}`);
        if (proposal.audiovisualMapping.audio.trim() !== proposal.audio.trim() || proposal.audiovisualMapping.visual.trim() !== proposal.visualRepresentation.trim()) {
          throw new StoryboardBlockedError('Storyboard audiovisual mapping does not match the segment payload');
        }
        const narrativeInventory = extractTechnicalConditions(scriptText.slice(proposal.narrativeStart, proposal.narrativeEnd), { path: script.scriptId, locator: `${proposal.narrativeStart}-${proposal.narrativeEnd}`, scope: 'segment' });
        const sourceInventories = resolvedSources.map(source => extractTechnicalConditions({ path: source.path, locator: source.locator, content: source.content, scope: 'segment' }));
        const inventories = [narrativeInventory, ...sourceInventories];
        const ambiguousExpressions = inventories.flatMap(inventory => inventory.ambiguousExpressions);
        if (ambiguousExpressions.length) {
          throw this.technicalBlock(proposal.segmentId, `Ambiguous technical condition: ${ambiguousExpressions.join(', ')}`, [], ambiguousExpressions);
        }
        const requiredConditions = inventories.flatMap(inventory => inventory.conditions);
        const uniqueConditions = new Map<string, TechnicalCondition>();
        for (const condition of requiredConditions) {
          if (uniqueConditions.has(condition.conditionId)) throw this.technicalBlock(proposal.segmentId, `Duplicate technical condition ID ${condition.conditionId}`, [condition]);
          uniqueConditions.set(condition.conditionId, condition);
        }
        const declaredInventory = extractTechnicalConditions(`${proposal.audio} ${proposal.visualRepresentation} ${proposal.audiovisualMapping.visual}`, { path: `proposal:${proposal.segmentId}`, locator: 'visual', scope: 'segment' });
        if (declaredInventory.state === 'AMBIGUOUS') throw this.technicalBlock(proposal.segmentId, `Ambiguous technical condition in visual representation`, [], declaredInventory.ambiguousExpressions);
        const required = [...uniqueConditions.values()];
        const coverageIds = proposal.technicalCoverage.map(coverage => coverage.conditionId);
        const comparison = compareTechnicalConditions(required, coverageIds);
        const contradictoryConditionIds = required.filter(condition => declaredInventory.conditions.some(declared => declared.type === condition.type && technicalConditionKey(declared) !== technicalConditionKey(condition))).map(condition => condition.conditionId);
        const validation = deriveMaterialValidation(proposal, scriptText, resolvedSources.map(source => source.content), {
          required,
          coverage: proposal.technicalCoverage,
          comparison,
          contradictoryConditionIds,
          ambiguousExpressions
        });
        if (!validation.supportsNarrative || !validation.preservesTechnicalConditions || validation.introducesUnsupportedClaims || validation.usesAudioAsSubtitlesOnly) {
          const failedCondition = required.find(condition => validation.missingConditionIds.includes(condition.conditionId) || validation.contradictoryConditionIds.includes(condition.conditionId));
          throw new StoryboardBlockedError(`Storyboard material validation failed for segment ${proposal.segmentId}${failedCondition ? `: condition ${failedCondition.conditionId} (${failedCondition.originalText}) at ${failedCondition.evidence.path}:${failedCondition.evidence.locator}` : ''}: ${validation.reasons.join('; ')}`, { segmentId: proposal.segmentId, conditionId: failedCondition?.conditionId, evidence: failedCondition?.evidence, validation });
        }
        const materializedCoverage = proposal.technicalCoverage.map(coverage => {
          const condition = required.find(candidate => candidate.conditionId === coverage.conditionId);
          if (!condition) throw this.technicalBlock(proposal.segmentId, `Unknown technical condition ID ${coverage.conditionId}`, []);
          return { ...coverage, condition, evidence: condition.evidence };
        });
        return validateStoryboardSegment({ ...proposal, version: 1, position: index, sourceReferences: resolvedSources, technicalConditions: required, technicalCoverage: materializedCoverage, validation });
      });
      return segments;
    } catch (error) {
      if (error instanceof SourceUnresolvedError || error instanceof StoryboardBlockedError) throw error;
      if (error instanceof ZodError) throw new StoryboardBlockedError('Storyboard material validation failed', { issues: error.issues });
      throw error;
    }
  }

  private technicalBlock(segmentId: string, reason: string, conditions: TechnicalCondition[], ambiguousConditionExpressions: string[] = []): StoryboardBlockedError {
    const condition = conditions[0];
    return new StoryboardBlockedError(`Storyboard technical validation blocked segment ${segmentId}: ${reason}`, { segmentId, conditionId: condition?.conditionId, evidence: condition?.evidence, ambiguousConditionExpressions });
  }

  private segmentToProposal(segment: StoryboardSegment): StoryboardSegmentProposal {
    return storyboardSegmentProposalSchema.parse({
      segmentId: segment.segmentId,
      narrativeSpan: segment.narrativeSpan,
      narrativeStart: segment.narrativeStart,
      narrativeEnd: segment.narrativeEnd,
      durationSeconds: segment.durationSeconds,
      audio: segment.audio,
      visualRepresentation: segment.visualRepresentation,
      audiovisualMapping: segment.audiovisualMapping,
      rhythm: segment.rhythm,
      synchronization: segment.synchronization,
      sourceReferences: segment.sourceReferences.map(source => ({ path: source.path, locator: source.locator, segmentId: source.segmentId })),
      technicalCoverage: segment.technicalCoverage.map(coverage => ({ conditionId: coverage.conditionId, applicationMode: coverage.applicationMode, ...(coverage.instruction ? { instruction: coverage.instruction } : {}) })),
      dependsOn: segment.dependsOn,
      ...(segment.reviewNote ? { reviewNote: segment.reviewNote } : {})
    });
  }

  private buildRevision(input: any): StoryboardRevision {
    const segments = input.segments as StoryboardSegment[];
    const sources = segments.flatMap(segment => segment.sourceReferences);
    return storyboardRevisionSchema.parse({
      opportunityId: input.opportunityId,
      storyboardId: input.storyboardId,
      storyboardRevisionId: input.storyboardRevisionId ?? `${input.storyboardId}-revision-${input.version}`,
      version: input.version,
      state: input.state,
      scriptId: input.scriptId,
      directorValidationId: input.directorValidationId,
      scriptAuthorization: input.scriptAuthorization,
      profile: normalizePublicationProfile(input.profile),
      segments,
      finalDurationSeconds: input.finalDurationSeconds ?? finalDuration(segments),
      targetDurationSeconds: input.targetDurationSeconds,
      sources,
      validations: segments.map(segment => segment.validation),
      corrections: input.corrections ?? [],
      blockedReason: input.blockedReason,
      blockedRecipient: input.blockedRecipient,
      createdAt: input.createdAt ?? new Date().toISOString()
    });
  }

  private tryGet(opportunityId: string) { try { return this.storyboard.get(opportunityId); } catch (error) { if (error instanceof NotFoundError) return undefined; throw error; } }
}

function canonicalLocator(reference: InlineReference): string {
  if (reference.section) return reference.section;
  return `${reference.startLine ?? 0}${reference.endLine && reference.endLine !== reference.startLine ? `-${reference.endLine}` : ''}`;
}

function canonicalLocatorFromInput(locator: string): string {
  const match = /^(\d+)(?:-(\d+))?$/.exec(locator);
  return match ? `${match[1]}${match[2] && match[2] !== match[1] ? `-${match[2]}` : ''}` : locator;
}

function referenceKey(reference: InlineReference): string {
  return `${reference.path}:${canonicalLocator(reference)}`;
}

function resolvePersistedSource(script: NarrativeScript, reference: InlineReference): string {
  const source = script.sources[reference.path];
  if (typeof source !== 'string') throw new SourceUnresolvedError(`Persisted source cannot be resolved: ${reference.path}`);
  if (reference.startLine) {
    const lines = source.split(/\r?\n/);
    const endLine = reference.endLine ?? reference.startLine;
    if (endLine > lines.length) throw new SourceUnresolvedError(`Persisted source line range cannot be resolved: ${reference.path}:${canonicalLocator(reference)}`);
    return lines.slice(reference.startLine - 1, endLine).join('\n');
  }
  if (!reference.section) throw new SourceUnresolvedError(`Persisted source locator cannot be resolved: ${reference.path}`);
  const lines = source.split(/\r?\n/);
  const matches = lines.map((line, index) => ({ line, index })).filter(item => {
    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(item.line);
    return heading?.[2].trim().toLocaleLowerCase() === reference.section!.trim().toLocaleLowerCase();
  });
  if (matches.length !== 1) throw new SourceUnresolvedError(`Persisted source section cannot be resolved unambiguously: ${reference.path}:${reference.section}`);
  const start = matches[0].index;
  const heading = /^\s*(#{1,6})\s+/u.exec(lines[start]);
  if (!heading) throw new SourceUnresolvedError(`Persisted source section cannot be resolved: ${reference.path}:${reference.section}`);
  const level = heading[1].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextHeading = /^\s*(#{1,6})\s+/u.exec(lines[index]);
    if (nextHeading && nextHeading[1].length <= level) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) throw new SourceUnresolvedError(`Persisted source section has no body: ${reference.path}:${reference.section}`);
  return body;
}

const ignoredClaimWords = new Set(['the', 'and', 'with', 'from', 'that', 'this', 'for', 'una', 'uno', 'unos', 'unas', 'con', 'para', 'del', 'las', 'los', 'por', 'que', 'de', 'la', 'el', 'audio', 'visual', 'meaning', 'narration', 'representation']);

function claimTokens(value: string): string[] {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(token => token.length > 2 && !ignoredClaimWords.has(token));
}

function deriveMaterialValidation(proposal: StoryboardSegmentProposal, scriptText: string, sourceContents: string[], technical: {
  required: TechnicalCondition[];
  coverage: StoryboardSegmentProposal['technicalCoverage'];
  comparison: ReturnType<typeof compareTechnicalConditions>;
  contradictoryConditionIds: string[];
  ambiguousExpressions: string[];
}) {
  const corpus = `${scriptText} ${sourceContents.join(' ')}`.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const spanTokens = claimTokens(proposal.narrativeSpan);
  const candidateTokens = claimTokens(`${proposal.audio} ${proposal.visualRepresentation} ${proposal.audiovisualMapping.narrativeMeaning} ${proposal.audiovisualMapping.visual}`);
  const unsupportedClaims = [...new Set(candidateTokens.filter(token => !corpus.includes(token)))];
  const supportsNarrative = normalizeForMatch(scriptText).includes(normalizeForMatch(proposal.narrativeSpan)) || spanTokens.every(token => corpus.includes(token));
  const preservesTechnicalConditions = technical.comparison.missingIds.length === 0
    && technical.comparison.unknownIds.length === 0
    && technical.comparison.duplicateIds.length === 0
    && technical.contradictoryConditionIds.length === 0
    && technical.ambiguousExpressions.length === 0
    && technical.coverage.length === technical.required.length;
  const usesAudioAsSubtitlesOnly = normalizeForMatch(proposal.visualRepresentation) === normalizeForMatch(proposal.audio);
  const reasons = [
    ...(!supportsNarrative ? ['Narrative span is not present in the persisted validated script or sources'] : []),
    ...(technical.comparison.missingIds.length ? [`Missing technical conditions: ${technical.comparison.missingIds.join(', ')}`] : []),
    ...(technical.comparison.unknownIds.length ? [`Unknown technical condition IDs: ${technical.comparison.unknownIds.join(', ')}`] : []),
    ...(technical.comparison.duplicateIds.length ? [`Duplicate technical condition IDs: ${technical.comparison.duplicateIds.join(', ')}`] : []),
    ...(technical.contradictoryConditionIds.length ? [`Contradictory technical conditions: ${technical.contradictoryConditionIds.join(', ')}`] : []),
    ...(technical.ambiguousExpressions.length ? [`Ambiguous technical conditions: ${technical.ambiguousExpressions.join(', ')}`] : []),
    ...(!preservesTechnicalConditions && !technical.comparison.missingIds.length && !technical.comparison.unknownIds.length && !technical.contradictoryConditionIds.length && !technical.ambiguousExpressions.length ? ['Technical condition coverage is incomplete'] : []),
    ...(unsupportedClaims.length ? [`Unsupported claims: ${unsupportedClaims.join(', ')}`] : []),
    ...(usesAudioAsSubtitlesOnly ? ['Audio repeated as subtitles is not a dual-channel representation'] : [])
  ];
  return {
    supportsNarrative,
    preservesTechnicalConditions,
    introducesUnsupportedClaims: unsupportedClaims.length > 0,
    usesAudioAsSubtitlesOnly,
    editorialChange: false,
    reasons,
    requiredConditionIds: technical.comparison.requiredIds,
    coveredConditionIds: technical.comparison.coveredIds,
    missingConditionIds: technical.comparison.missingIds,
    unknownConditionIds: technical.comparison.unknownIds,
    duplicateConditionIds: technical.comparison.duplicateIds,
    contradictoryConditionIds: technical.contradictoryConditionIds,
    ambiguousConditionExpressions: technical.ambiguousExpressions
  };
}

function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
