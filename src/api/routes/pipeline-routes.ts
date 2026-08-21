import type { FastifyInstance } from 'fastify'; import { z } from 'zod'; import { PipelineService } from '../../application/pipeline-service.js'; import { sendError } from '../http-errors.js';
const id=z.object({id:z.string().min(1)}); const actor=z.string().min(1); const role=z.enum(['DIRECTOR','WRITER','STORYBOARD','EDITOR']);
export async function pipelineRoutes(app:FastifyInstance, service:PipelineService){
 app.post('/opportunities',async(req,res)=>{try{const b=z.object({opportunityId:z.string().min(1)}).parse(req.body); return res.code(201).send(service.createOpportunity(b.opportunityId));}catch(e){return sendError(res,e);}});
 app.post('/opportunities/:id/authorize',async(req,res)=>{try{const p=id.parse(req.params); const b=z.object({role,actor}).parse(req.body); return res.send(service.authorize(p.id,b.role,b.actor));}catch(e){return sendError(res,e);}});
 app.post('/opportunities/:id/advance',async(req,res)=>{try{const p=id.parse(req.params); const b=z.object({role,actor,payload:z.unknown()}).parse(req.body); return res.send(service.advance(p.id,b.actor,b.role,b.payload));}catch(e){return sendError(res,e);}});
 app.post('/opportunities/:id/block',async(req,res)=>{try{const p=id.parse(req.params); const b=z.object({actor,reason:z.string().min(1)}).parse(req.body); return res.send(service.block(p.id,b.actor,b.reason));}catch(e){return sendError(res,e);}});
 app.post('/opportunities/:id/return',async(req,res)=>{try{const p=id.parse(req.params); const b=z.object({actor,reason:z.string().min(1)}).parse(req.body); return res.send(service.returnToOwnStage(p.id,b.actor,b.reason));}catch(e){return sendError(res,e);}});
 app.get('/opportunities/:id/lineage',async(req,res)=>{try{return res.send(service.lineage(id.parse(req.params).id));}catch(e){return sendError(res,e);}});
}
