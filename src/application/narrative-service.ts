import { z } from 'zod';
import { validateHandoff } from '../domain/handoffs.js';
import { AuthorizationRequiredError, NarrativeBlockedError, NarrativeStateError, ValidationError } from '../domain/errors.js';
import {
  narrativeConfigurationProposalSchema,
  persistedNarrativeConfigurationSchema,
  narrativeScriptSchema,
  parseInlineReferences,
  type PersistedNarrativeConfiguration,
  type NarrativeScript
} from '../domain/narrative.js';
import { CurationRepository } from '../infrastructure/repositories/curation-repository.js';
import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';

const actorSchema = z.string().min(1);
const generationInputSchema = z.object({
  narrativeText: z.string().min(1),
  sources: z.record(z.string()).default({}),
  materialGap: z.string().min(1).optional(),
  actor: actorSchema.optional()
}).strict();

export class NarrativeService {
  constructor(
    private narrative: NarrativeRepository,
    private curation: CurationRepository,
    private pipeline: PipelineRepository
  ) {}

  proposeConfiguration(opportunityId: string, input: unknown, director = 'director') {
    actorSchema.parse(director);
    const proposal = narrativeConfigurationProposalSchema.parse(input);
    const configurationId = `${opportunityId}-narrative-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return this.narrative.createConfiguration(opportunityId, configurationId, { ...proposal, director });
  }

  getConfiguration(opportunityId: string, configurationId?: string) { return this.narrative.getConfiguration(opportunityId, configurationId); }

  approveConfiguration(opportunityId: string, configurationId: string, input: unknown) {
    const actor = actorSchema.parse((input as any)?.actor);
    return this.narrative.approveConfiguration(opportunityId, configurationId, actor);
  }

  generate(opportunityId: string, input: unknown) {
    const parsed = generationInputSchema.parse(input);
    const actor = parsed.actor ?? 'narrator';
    if (!this.curation.hasApprovedProposal(opportunityId)) throw new AuthorizationRequiredError('Approved editorial curation is required before generating a narrative');
    const configuration = this.narrative.getConfiguration(opportunityId) as any;
    if (configuration.state !== 'READY_TO_GENERATE' || !configuration.userApproved) throw new AuthorizationRequiredError('User approval of the narrative configuration is required');
    const approvedConfiguration = persistedNarrativeConfigurationSchema.parse(configuration.payload);
    if (parsed.materialGap) {
      const script = this.createBlockedScript(opportunityId, approvedConfiguration, parsed.narrativeText, parsed.materialGap, actor);
      throw new NarrativeBlockedError('Narrative blocked by a material information gap', { script });
    }
    const references = parseInlineReferences(parsed.narrativeText, parsed.sources);
    const scriptId = `${opportunityId}-narrative-script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const draft = this.narrative.createScript(opportunityId, scriptId, approvedConfiguration.configurationId, {
      narrativeText: parsed.narrativeText,
      references,
      sources: parsed.sources,
      targetDurationSeconds: approvedConfiguration.targetDurationSeconds
    }, 'DRAFT', actor);
    return this.narrative.setScriptState(opportunityId, draft.scriptId, 'READY_FOR_DIRECTOR_VALIDATION', actor);
  }

  getScript(opportunityId: string, scriptId?: string) { return this.narrative.getScript(opportunityId, scriptId); }

  block(opportunityId: string, input: unknown) {
    const actor = actorSchema.parse((input as any)?.actor);
    const reason = z.string().min(1).parse((input as any)?.reason);
    const current = this.narrative.getScript(opportunityId) as NarrativeScript;
    return this.narrative.setScriptState(opportunityId, current.scriptId, 'BLOCKED', actor, {}, reason);
  }

  clarify(opportunityId: string, input: unknown) {
    const actor = actorSchema.parse((input as any)?.actor);
    const parsed = z.object({ actor: actorSchema, narrativeText: z.string().min(1), sources: z.record(z.string()).default({}) }).strict().parse(input);
    const current = this.narrative.getScript(opportunityId) as NarrativeScript;
    if (current.state !== 'BLOCKED') throw new NarrativeStateError('Only a blocked narrative can receive a clarification');
    const configuration = this.narrative.getConfiguration(opportunityId, current.configurationId) as any;
    const approvedConfiguration = persistedNarrativeConfigurationSchema.parse(configuration.payload);
    const references = parseInlineReferences(parsed.narrativeText, parsed.sources);
    const scriptId = `${opportunityId}-narrative-script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return this.narrative.createScript(opportunityId, scriptId, approvedConfiguration.configurationId, {
      narrativeText: parsed.narrativeText,
      references,
      sources: parsed.sources,
      targetDurationSeconds: approvedConfiguration.targetDurationSeconds
    }, 'DRAFT', actor, undefined);
  }

  validateDirector(opportunityId: string, input: unknown) {
    const body = z.object({ actor: actorSchema, role: z.literal('DIRECTOR') }).strict().parse(input);
    const actor = body.actor;
    const current = this.narrative.getScript(opportunityId) as NarrativeScript;
    if (current.state !== 'READY_FOR_DIRECTOR_VALIDATION') throw new NarrativeStateError('Only a script ready for Director validation can be validated');
    return this.narrative.transaction(() => {
      const authorization = this.pipeline.authorizeNarrative(opportunityId, actor);
      return this.narrative.setScriptState(opportunityId, current.scriptId, 'DIRECTOR_VALIDATED', actor, {
        directorValidationId: current.scriptId,
        scriptAuthorization: String(authorization)
      });
    });
  }

  handoff(opportunityId: string) {
    const script = narrativeScriptSchema.parse(this.narrative.getScript(opportunityId));
    if (script.state !== 'DIRECTOR_VALIDATED' || !script.directorValidationId || !script.scriptAuthorization) throw new AuthorizationRequiredError('Director validation is required before the storyboard handoff');
    const configuration = persistedNarrativeConfigurationSchema.parse((this.narrative.getConfiguration(opportunityId, script.configurationId) as any).payload);
    const handoffConfiguration = {
      audience: configuration.audience,
      tone: configuration.tone,
      depth: configuration.depth,
      voice: configuration.voice,
      style: configuration.style,
      targetDurationSeconds: configuration.targetDurationSeconds,
      userApproved: configuration.userApproved
    };
    return validateHandoff('SCRIPT', {
      opportunityId,
      scriptId: script.scriptId,
      authorizedScript: script.narrativeText,
      references: script.references,
      configuration: handoffConfiguration,
      targetDurationSeconds: script.targetDurationSeconds,
      validationStatus: 'DIRECTOR_VALIDATED',
      directorValidationId: script.directorValidationId,
      scriptAuthorization: script.scriptAuthorization
    });
  }

  lineage(opportunityId: string) {
    return { opportunityId, narrative: this.narrative.history(opportunityId) };
  }

  private createBlockedScript(opportunityId: string, configuration: PersistedNarrativeConfiguration, narrativeText: string, reason: string, actor: string) {
    const scriptId = `${opportunityId}-narrative-script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return this.narrative.createScript(opportunityId, scriptId, configuration.configurationId, {
      narrativeText,
      references: [],
      targetDurationSeconds: configuration.targetDurationSeconds
    }, 'BLOCKED', actor, reason);
  }
}
