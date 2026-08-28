import { z } from 'zod'; import { STATES, validateAdvance, transitionFor, type Role, type PipelineState } from '../domain/pipeline.js'; import { validateHandoff } from '../domain/handoffs.js'; import { AuthorizationRequiredError, ValidationError, TransitionNotAllowedError } from '../domain/errors.js'; import { narrativeConfigurationSchema, narrativeScriptSchema, persistedNarrativeConfigurationSchema, type NarrativeScript } from '../domain/narrative.js'; import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js'; import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js'; import type { StoryboardService } from './storyboard-service.js';
const idSchema=z.string().min(1); const actorSchema=z.string().min(1); const roleSchema=z.enum(['DIRECTOR','WRITER','STORYBOARD','EDITOR']);
export class PipelineService {
  constructor(private repo:PipelineRepository, private narrative?:NarrativeRepository, private storyboard?: StoryboardService) {}
  createOpportunity(opportunityId:string){idSchema.parse(opportunityId); this.repo.create(opportunityId); return this.repo.get(opportunityId);}
   authorize(id:string, role:Role, actor:string){actorSchema.parse(actor); const o=this.repo.get(id); if(o.state==='BLOCKED') throw new ValidationError('Blocked opportunity cannot be authorized'); if(o.state==='NOTE' && this.repo.hasEditorialProposal(id)) throw new ValidationError('NOTE requires editorial approval'); const t=transitionFor(o.state as PipelineState); if(t.role!==role) throw new ValidationError(`Role ${role} is not responsible for ${o.state}`); if(o.state==='SCRIPT' && role==='WRITER') throw new AuthorizationRequiredError('Narrative validation must issue the SCRIPT authorization'); this.repo.authorize(id,o.state,role,actor); this.repo.event(id,'AUTHORIZED',o.state, t.to,actor); return this.repo.get(id);}
   advance(id:string, actor:string, role:Role, payload:unknown){actorSchema.parse(actor); roleSchema.parse(role); const o=this.repo.get(id); const authorization=this.repo.authorization(id,o.stableState,role); const t=validateAdvance(o.state,role,authorization); const valid=validateHandoff(t.from,payload); if((valid as any).opportunityId!==id) throw new ValidationError('Handoff opportunityId does not match path'); if(t.from==='SCRIPT') this.validateNarrativeHandoff(id,valid); this.repo.transaction(()=>{const auth=this.repo.authorization(id,t.from,role); if(!auth) throw new AuthorizationRequiredError('A persisted authorization is required'); if(t.from==='STORYBOARD'){ if(!this.storyboard) throw new AuthorizationRequiredError('Storyboard service is required for the STORYBOARD handoff'); this.storyboard.validateForPipeline(id,valid); } this.repo.consumeAuthorization(auth.id); this.repo.advance(id,t.from,t.to,valid,actor);}); return this.repo.get(id);}
 block(id:string, actor:string, reason:string){actorSchema.parse(actor); if(!reason?.trim()) throw new ValidationError('Block reason is required'); this.repo.block(id,reason,actor); return this.repo.get(id);}
 returnToOwnStage(id:string, actor:string, reason:string){actorSchema.parse(actor); if(!reason?.trim()) throw new ValidationError('Return reason is required'); this.repo.returnToOwnStage(id,actor,reason); return this.repo.get(id);}
  rollback(id:string, target:string, actor:string, reason:string){actorSchema.parse(actor); if(!reason?.trim()) throw new ValidationError('Rollback reason is required'); if(!STATES.includes(target as PipelineState)) throw new ValidationError(`Invalid rollback target: ${target}`); const targetState=target as PipelineState; const o=this.repo.get(id); const currentIndex=STATES.indexOf(o.state as PipelineState); const targetIndex=STATES.indexOf(targetState); if(targetIndex>=currentIndex) throw new TransitionNotAllowedError(`Cannot rollback from ${o.state} to ${targetState}: target must be an earlier stage`); this.repo.rollback(id,targetState,actor,reason); return this.repo.get(id);}
  lineage(id:string){return this.repo.lineage(id);}

  private validateNarrativeHandoff(opportunityId:string, payload:unknown) {
    if (!this.narrative) throw new AuthorizationRequiredError('Narrative repository is required for the SCRIPT handoff');
    const handoff = payload as { scriptId:string; authorizedScript:string; references:unknown; configuration:unknown; targetDurationSeconds?:number; directorValidationId:string; scriptAuthorization:string };
    const script = narrativeScriptSchema.parse(this.narrative.getScript(opportunityId, handoff.scriptId)) as NarrativeScript;
    if (script.state !== 'DIRECTOR_VALIDATED') throw new AuthorizationRequiredError('Only a Director-validated narrative can enter the storyboard');
    if (handoff.scriptId !== script.scriptId || handoff.authorizedScript !== script.narrativeText || handoff.directorValidationId !== script.directorValidationId || handoff.scriptAuthorization !== script.scriptAuthorization) {
      throw new AuthorizationRequiredError('Narrative handoff does not match the persisted validated script');
    }
    if (JSON.stringify(handoff.references) !== JSON.stringify(script.references) || handoff.targetDurationSeconds !== script.targetDurationSeconds) {
      throw new AuthorizationRequiredError('Narrative handoff metadata does not match the persisted script');
    }
    const configuration = this.narrative.getConfiguration(opportunityId, script.configurationId) as any;
    const persistedConfiguration = persistedNarrativeConfigurationSchema.parse(configuration.payload);
    const approvedConfiguration = {
      audience: persistedConfiguration.audience,
      tone: persistedConfiguration.tone,
      depth: persistedConfiguration.depth,
      voice: persistedConfiguration.voice,
      style: persistedConfiguration.style,
      targetDurationSeconds: persistedConfiguration.targetDurationSeconds,
      userApproved: persistedConfiguration.userApproved
    };
    const requestedConfiguration = narrativeConfigurationSchema.parse(handoff.configuration);
    if (JSON.stringify(approvedConfiguration) !== JSON.stringify(requestedConfiguration)) {
      throw new AuthorizationRequiredError('Narrative handoff configuration is not the approved configuration');
    }
    const authorizationId = Number(script.scriptAuthorization);
    const authorization = Number.isInteger(authorizationId) ? this.repo.authorizationById(authorizationId) : undefined;
    if (!authorization || authorization.opportunity_id !== opportunityId || authorization.from_state !== 'SCRIPT' || authorization.role !== 'WRITER' || authorization.consumed) {
      throw new AuthorizationRequiredError('Narrative authorization is missing, invalid, or already consumed');
    }
  }
}
