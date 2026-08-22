import { describe,it,expect,afterEach } from 'vitest'; import { openDatabase } from '../infrastructure/db/database.js'; import { NarrativeRepository } from '../infrastructure/repositories/narrative-repository.js'; import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js'; import { PipelineService } from './pipeline-service.js';
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
});
