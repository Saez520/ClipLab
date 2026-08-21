import type { FastifyInstance } from 'fastify';
import { SynthesisService } from '../../application/synthesis-service.js';
import { sendError } from '../http-errors.js';
export async function synthesisRoutes(app:FastifyInstance, service:SynthesisService){
 app.post('/opportunities/:id/synthesis/sessions',async(req,res)=>{try{const b=req.body as any;return res.code(201).send(service.startSession({...(b??{}),opportunityId:(req.params as any).id}));}catch(e){return sendError(res,e);}});
 app.post('/opportunities/:id/synthesis/queries',async(req,res)=>{try{const b=req.body as any;return res.code(201).send(service.delegate({...(b??{}),opportunityId:(req.params as any).id}));}catch(e){return sendError(res,e);}});
 app.post('/synthesis/queries/:queryId/result',async(req,res)=>{try{return res.send(service.saveResult((req.params as any).queryId,req.body));}catch(e){return sendError(res,e);}});
 app.get('/opportunities/:id/synthesis/sessions/:sessionId/queries/:queryId',async(req,res)=>{try{const p=req.params as any;return res.send(service.getResult(p.queryId,p.sessionId,p.id));}catch(e){return sendError(res,e);}});
 app.get('/opportunities/:id/synthesis/sessions/:sessionId/queries/:queryId/handoff',async(req,res)=>{try{const p=req.params as any;return res.send(service.handoff(p.queryId,p.sessionId,p.id));}catch(e){return sendError(res,e);}});
}
