import { describe,it,expect,afterEach } from 'vitest'; import { openDatabase } from '../infrastructure/db/database.js'; import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js'; import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js'; import { StoryboardRepository } from '../infrastructure/repositories/storyboard-repository.js'; import { StoryboardService } from './storyboard-service.js'; import { AuthorizationRequiredError } from '../domain/errors.js'; import { PipelineService } from './pipeline-service.js';
let db:any; afterEach(()=>db?.close());
describe('pipeline service',()=>{
  it('advances with explicit authorization and preserves lineage',()=>{db=openDatabase(':memory:'); const s=new PipelineService(new PipelineRepository(db)); s.createOpportunity('o1'); expect(()=>s.advance('o1','d','DIRECTOR',{opportunityId:'o1',originalNote:'n',directorDecision:'ok',centralApproach:'a'})).toThrow(); s.authorize('o1','DIRECTOR','d'); s.advance('o1','d','DIRECTOR',{opportunityId:'o1',originalNote:'n',directorDecision:'ok',centralApproach:'a'}); expect(s.lineage('o1').state).toBe('SCRIPT'); expect(s.lineage('o1').handoffs).toHaveLength(1);});
  it('blocks visibly without automatic progress',()=>{db=openDatabase(':memory:'); const s=new PipelineService(new PipelineRepository(db)); s.createOpportunity('o2'); s.block('o2','needs review','director'); expect(s.lineage('o2').state).toBe('BLOCKED'); expect(()=>s.advance('o2','d','DIRECTOR',{})).toThrow();});
  it('consumes authorization once',()=>{db=openDatabase(':memory:');const s=new PipelineService(new PipelineRepository(db));s.createOpportunity('o3');s.authorize('o3','DIRECTOR','d');s.advance('o3','d','DIRECTOR',{opportunityId:'o3',originalNote:'n',directorDecision:'ok',centralApproach:'a'});expect(()=>s.advance('o3','d','WRITER',{})).toThrow();});
  it('rejects mismatched handoff identity',()=>{db=openDatabase(':memory:');const s=new PipelineService(new PipelineRepository(db));s.createOpportunity('o4');s.authorize('o4','DIRECTOR','d');expect(()=>s.advance('o4','d','DIRECTOR',{opportunityId:'other',originalNote:'n',directorDecision:'ok',centralApproach:'a'})).toThrow();});
  it('rejects a forged Director-validated narrative handoff',()=>{
    db=openDatabase(':memory:');
    const pipeline = new PipelineRepository(db);
    const narrative = new NarrativeRepository(db);
    const s = new PipelineService(pipeline, narrative);
    s.createOpportunity('o5');
    s.authorize('o5','DIRECTOR','director');
    s.advance('o5','director','DIRECTOR',{opportunityId:'o5',originalNote:'n',directorDecision:'ok',centralApproach:'a'});
    pipeline.authorizeNarrative('o5', 'writer');
    expect(() => s.advance('o5','writer','WRITER',{
      opportunityId:'o5', scriptId:'forged', authorizedScript:'forged', references:[],
      configuration:{audience:'a',tone:'t',depth:'d',voice:'v',style:'s',userApproved:true},
      validationStatus:'DIRECTOR_VALIDATED', directorValidationId:'forged', scriptAuthorization:'1'
    })).toThrow();
   expect(pipeline.get('o5').state).toBe('SCRIPT');
  });

  it('rejects a tampered storyboard handoff without consuming authorization or advancing',()=>{
    db=openDatabase(':memory:');
    const pipeline = new PipelineRepository(db);
    const narrative = new NarrativeRepository(db);
    const storyboard = new StoryboardService(new StoryboardRepository(db), narrative, pipeline);
    const s = new PipelineService(pipeline, narrative, storyboard);
    pipeline.create('o6');
    pipeline.authorize('o6','NOTE','DIRECTOR','director');
    pipeline.advance('o6','NOTE','SCRIPT',{opportunityId:'o6',originalNote:'n',directorDecision:'ok',centralApproach:'a'},'director');
    const configuration = narrative.createConfiguration('o6', 'configuration', { audience:'developers', tone:'direct', depth:'deep', voice:'calm', style:'continuous', director:'director' });
    narrative.approveConfiguration('o6', configuration.configuration_id, 'user');
    narrative.createScript('o6', 'script', 'configuration', { narrativeText:'Narrative span [source.md:1]', references:[{ raw:'[source.md:1]', path:'source.md', locator:'lines', startLine:1, endLine:1 }], sources:{ 'source.md':'Narrative span audio visual diagram meaning' } }, 'DRAFT', 'narrator');
    narrative.setScriptState('o6', 'script', 'READY_FOR_DIRECTOR_VALIDATION', 'narrator');
    const scriptAuthorization = pipeline.authorizeNarrative('o6', 'director');
    narrative.setScriptState('o6', 'script', 'DIRECTOR_VALIDATED', 'director', { directorValidationId:'validation', scriptAuthorization:String(scriptAuthorization) });
    s.advance('o6','writer','WRITER',{
       opportunityId:'o6', scriptId:'script', authorizedScript:'Narrative span [source.md:1]', references:[{ raw:'[source.md:1]', path:'source.md', locator:'lines', startLine:1, endLine:1 }],
      configuration:{ audience:'developers', tone:'direct', depth:'deep', voice:'calm', style:'continuous', userApproved:true },
      validationStatus:'DIRECTOR_VALIDATED', directorValidationId:'validation', scriptAuthorization:String(scriptAuthorization)
    });
     storyboard.create('o6', { segments:[{ segmentId:'s1', narrativeSpan:'Narrative span', narrativeStart:0, narrativeEnd:14, durationSeconds:30, audio:'audio', visualRepresentation:'diagram', audiovisualMapping:{ narrativeMeaning:'meaning', audio:'audio', visual:'diagram', correspondence:'mapped' }, rhythm:'steady', synchronization:'sync', sourceReferences:[{ path:'source.md', locator:'1', segmentId:'s1' }], technicalCoverage:[] }] });
    const storyboardRevision = new StoryboardRepository(db).getRevision('o6');
    storyboard.approve('o6', { actor:'user', storyboardRevisionId:storyboardRevision.storyboardRevisionId });
    pipeline.authorize('o6','STORYBOARD','STORYBOARD','user');
    const handoff = storyboard.handoff('o6');
    const tampered = { ...handoff, authorizedSegments: handoff.authorizedSegments.map(segment => ({ ...segment, visualRepresentation:'tampered visual', audiovisualMapping:{ ...segment.audiovisualMapping, visual:'tampered visual' } })) };

    expect(() => s.advance('o6','user','STORYBOARD',tampered)).toThrow(AuthorizationRequiredError);
    expect(pipeline.authorization('o6','STORYBOARD','STORYBOARD')).toMatchObject({ consumed:0 });
    expect(pipeline.get('o6').state).toBe('STORYBOARD');
    expect(pipeline.lineage('o6').handoffs).toHaveLength(2);
    expect(storyboard.get('o6').storyboardRevisionId).toBe(storyboardRevision.storyboardRevisionId);
  });
});
