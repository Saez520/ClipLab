import { describe,it,expect } from 'vitest'; import { curationInputSchema,evaluateCuration } from './curation.js';
const base={originalNote:'nota',evidence:'prueba propia',centralApproach:'enfoque',audience:'BOTH' as const,objective:'DISCOVERY' as const};
describe('curation policy',()=>{
 it('approves concrete opportunity',()=>expect(evaluateCuration(curationInputSchema.parse(base)).result).toBe('APPROVE'));
 it('scopes broad topic',()=>expect(evaluateCuration(curationInputSchema.parse({...base,tooBroad:true})).result).toBe('SCOPE'));
 it('requests missing evidence',()=>expect(evaluateCuration(curationInputSchema.parse({...base,evidence:undefined})).result).toBe('REQUEST_CONTEXT'));
 it('discards saturated topic without differentiation',()=>expect(evaluateCuration(curationInputSchema.parse({...base,genericSaturated:true})).result).toBe('DISCARD'));
 it('warns unilateral audience',()=>expect(evaluateCuration(curationInputSchema.parse({...base,audience:'TECHNICAL_HIRING_MANAGERS'})).warnings.join(' ')).toContain('unilateral'));
 it('warns proof of concept input can be overridden',()=>expect(evaluateCuration(curationInputSchema.parse({...base,evidence:undefined})).gaps.length).toBeGreaterThan(0));
 it('keeps Spanish adaptation and optional duration',()=>{const p=evaluateCuration(curationInputSchema.parse({...base,sourceLanguage:'en',targetDurationSeconds:30})); expect(p.warnings.join(' ')).toContain('español'); expect(p.targetDurationSeconds).toBe(30);});
});
